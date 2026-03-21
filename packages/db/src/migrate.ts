import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { validateStatement } from './dsql-compat';

export interface MigrateOptions {
  pool: Pool;
  migrationsDir: string;
}

export async function migrate({ pool, migrationsDir }: MigrateOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY,
        executed_at bigint NOT NULL
      )
    `);

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') || f.endsWith('.ts') || f.endsWith('.mjs'))
      .sort();

    for (const file of migrationFiles) {
      const existing = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (existing.rows.length > 0) {
        console.log(`Skipping (already applied): ${file}`);
        continue;
      }

      console.log(`Running migration: ${file}`);

      if (file.endsWith('.sql')) {
        await runSqlMigration(client, path.join(migrationsDir, file), file);
      } else {
        await runTsMigration(client, path.join(migrationsDir, file));
      }

      await client.query('INSERT INTO _migrations (name, executed_at) VALUES ($1, $2)', [file, Date.now()]);
    }

    console.log('Migrations complete');
  } finally {
    client.release();
  }
}

async function runSqlMigration(client: PoolClient, filePath: string, file: string): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf8');
  const statements = content
    .split('\n\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    validateStatement(statement, file);
    try {
      await client.query('BEGIN');
      await client.query(statement);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message?.includes('already exists')) {
        console.log(`  Skipping (already exists): ${statement.slice(0, 80)}`);
      } else {
        throw error;
      }
    }
  }
}

async function runTsMigration(client: PoolClient, filePath: string): Promise<void> {
  const mod = await import(filePath);
  if (typeof mod.default !== 'function') {
    throw new Error(`TS migration ${filePath} must export a default async function(client: PoolClient)`);
  }
  await mod.default(client);
}
