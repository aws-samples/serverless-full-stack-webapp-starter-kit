import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Pool } from 'pg';

const DSQL_INCOMPATIBLE_PATTERNS = [
  {
    pattern: /CREATE\s+INDEX\s+(?!.*ASYNC)/i,
    message: 'CREATE INDEX must use ASYNC keyword for DSQL',
  },
  { pattern: /REFERENCES\s+/i, message: 'FOREIGN KEY / REFERENCES not supported by DSQL' },
  { pattern: /FOREIGN\s+KEY/i, message: 'FOREIGN KEY not supported by DSQL' },
  { pattern: /ALTER\s+.*\s+TYPE\s+/i, message: 'ALTER COLUMN TYPE not supported by DSQL' },
  { pattern: /DROP\s+COLUMN/i, message: 'DROP COLUMN not supported by DSQL' },
];

function validateStatement(statement: string, file: string): void {
  for (const { pattern, message } of DSQL_INCOMPATIBLE_PATTERNS) {
    if (pattern.test(statement)) {
      throw new Error(`DSQL incompatible SQL in ${file}: ${message}\n  Statement: ${statement.slice(0, 200)}`);
    }
  }
}

export interface MigrateOptions {
  pool: Pool;
  migrationsDir: string;
}

export async function migrate({ pool, migrationsDir }: MigrateOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id integer PRIMARY KEY,
        name text NOT NULL,
        hash text NOT NULL,
        executed_at bigint
      )
    `);

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const existing = await client.query('SELECT hash FROM _migrations WHERE name = $1', [file]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].hash !== hash) {
          throw new Error(`Migration ${file} has been modified after execution (hash mismatch)`);
        }
        continue;
      }

      console.log(`Running migration: ${file}`);
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

      const maxId = await client.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM _migrations');
      await client.query('INSERT INTO _migrations (id, name, hash, executed_at) VALUES ($1, $2, $3, $4)', [
        maxId.rows[0].next_id,
        file,
        hash,
        Date.now(),
      ]);
    }

    console.log('Migrations complete');
  } finally {
    client.release();
  }
}
