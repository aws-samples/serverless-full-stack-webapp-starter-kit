import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { migrate } from './migrate';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const endpoint = process.env.DSQL_ENDPOINT;
const region = process.env.AWS_REGION || 'us-west-2';

describe.skipIf(!endpoint)('migrate integration (DSQL)', () => {
  let pool: AuroraDSQLPool;
  let tmpDir: string;

  beforeAll(() => {
    pool = new AuroraDSQLPool({
      host: endpoint!,
      region,
      user: 'admin',
      database: 'postgres',
      port: 5432,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up tables from previous test
    const client = await pool.connect();
    try {
      for (const table of ['_migrations', 'TodoItem', 'User', 'TestTable', 'TestTable_new', 'Comment']) {
        try {
          await client.query(`DROP TABLE IF EXISTS "${table}"`);
        } catch {
          // ignore
        }
      }
    } finally {
      client.release();
    }
    // Create fresh temp migrations dir
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsql-integ-'));
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('I1: initial migration creates tables and index', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      `CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);\n\nCREATE TABLE IF NOT EXISTS "TodoItem" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  "title" text NOT NULL,\n  "userId" text NOT NULL\n);\n\nCREATE INDEX ASYNC IF NOT EXISTS "TodoItem_userId_idx" ON "TodoItem" ("userId");`,
    );

    await migrate({ pool, migrationsDir: tmpDir });

    const client = await pool.connect();
    try {
      const migrations = await client.query('SELECT name FROM _migrations ORDER BY name');
      expect(migrations.rows).toHaveLength(1);
      expect(migrations.rows[0].name).toBe('0001_initial.sql');

      // Verify tables exist
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('User', 'TodoItem')",
      );
      expect(tables.rows).toHaveLength(2);
    } finally {
      client.release();
    }
  });

  test('I2: idempotent re-run', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      'CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);',
    );

    await migrate({ pool, migrationsDir: tmpDir });
    // Re-run should not throw
    await migrate({ pool, migrationsDir: tmpDir });

    const client = await pool.connect();
    try {
      const migrations = await client.query('SELECT name FROM _migrations');
      expect(migrations.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  test('I3: incremental migration', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      'CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);',
    );
    fs.writeFileSync(
      path.join(tmpDir, '0002_add_column.sql'),
      'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" text;',
    );

    await migrate({ pool, migrationsDir: tmpDir });

    const client = await pool.connect();
    try {
      const migrations = await client.query('SELECT name FROM _migrations ORDER BY name');
      expect(migrations.rows).toHaveLength(2);

      // Verify column exists
      const cols = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'name'",
      );
      expect(cols.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  test('I4: modified applied file still skipped (no hash check)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      'CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);',
    );
    await migrate({ pool, migrationsDir: tmpDir });

    // Modify the file content
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      '-- modified\nCREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);',
    );
    // Should not throw
    await migrate({ pool, migrationsDir: tmpDir });
  });

  test('I5: already exists skip — re-insert _migrations after manual delete', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001_initial.sql'),
      'CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);',
    );
    await migrate({ pool, migrationsDir: tmpDir });

    // Delete _migrations record but keep the table
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM _migrations WHERE name = '0001_initial.sql'");
    } finally {
      client.release();
    }

    // Re-run: CREATE TABLE will get "already exists", should skip and re-insert _migrations
    await migrate({ pool, migrationsDir: tmpDir });

    const client2 = await pool.connect();
    try {
      const migrations = await client2.query('SELECT name FROM _migrations');
      expect(migrations.rows).toHaveLength(1);
    } finally {
      client2.release();
    }
  });

  test('I6: multiple statements in separate transactions', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '0001.sql'),
      'CREATE TABLE IF NOT EXISTS "User" (\n  "id" text PRIMARY KEY\n);\n\nCREATE INDEX ASYNC IF NOT EXISTS "User_id_idx" ON "User" ("id");',
    );

    // Should not throw — each statement in its own transaction
    await migrate({ pool, migrationsDir: tmpDir });
  });

  test('I7: DSQL incompatible SQL rejected at runtime', async () => {
    fs.writeFileSync(path.join(tmpDir, '0001.sql'), 'CREATE INDEX "bad_idx" ON "User" ("id");');

    await expect(migrate({ pool, migrationsDir: tmpDir })).rejects.toThrow('CREATE INDEX');
  });

  test('I10: .mjs migration execution', async () => {
    // First create the table via SQL
    fs.writeFileSync(
      path.join(tmpDir, '0001_create.sql'),
      'CREATE TABLE IF NOT EXISTS "TestTable" (\n  "id" text PRIMARY KEY,\n  "value" text\n);',
    );
    // Then run a .mjs migration that inserts data
    fs.writeFileSync(
      path.join(tmpDir, '0002_seed.mjs'),
      `export default async function(client) {
  await client.query('BEGIN');
  await client.query("INSERT INTO \\"TestTable\\" (id, value) VALUES ('1', 'hello')");
  await client.query('COMMIT');
};`,
    );

    await migrate({ pool, migrationsDir: tmpDir });

    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM "TestTable" WHERE id = \'1\'');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBe('hello');

      const migrations = await client.query('SELECT name FROM _migrations ORDER BY name');
      expect(migrations.rows).toHaveLength(2);
    } finally {
      client.release();
    }
  });

  test('I11: transformed SQL executes on DSQL', async () => {
    // Pre-create TodoItem so the ALTER TABLE in composite.expected.sql succeeds
    fs.writeFileSync(
      path.join(tmpDir, '0001_pre.sql'),
      'CREATE TABLE IF NOT EXISTS "TodoItem" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  "title" text NOT NULL\n);',
    );
    // Use the actual composite.expected.sql fixture (post-transform output)
    const fixturesDir = path.join(__dirname, 'fixtures');
    const transformed = fs.readFileSync(path.join(fixturesDir, 'composite.expected.sql'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, '0002_composite.sql'), transformed);

    await migrate({ pool, migrationsDir: tmpDir });

    const client = await pool.connect();
    try {
      const tables = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('Comment', 'TodoItem')",
      );
      expect(tables.rows).toHaveLength(2);
    } finally {
      client.release();
    }
  });
});
