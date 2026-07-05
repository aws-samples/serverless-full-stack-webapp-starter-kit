import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { transformSql, validateStatement } from './dsql-compat';
import { isMigrationFile } from './migration-files';

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

    const migrationFiles = fs.readdirSync(migrationsDir).filter(isMigrationFile).sort();

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
        await runModuleMigration(client, path.join(migrationsDir, file));
      }

      await client.query('INSERT INTO _migrations (name, executed_at) VALUES ($1, $2)', [file, Date.now()]);
    }

    console.log('Migrations complete');
  } finally {
    client.release();
  }
}

/**
 * SQL files are split into statements by blank lines (`\n\n`).
 * Do NOT include blank lines inside a single SQL statement (e.g. within CREATE TABLE).
 * drizzle-kit generate uses `--> statement-breakpoint` which check-dsql-compat.ts
 * transforms to blank lines. Hand-written SQL must follow the same convention.
 *
 * transformSql is applied again at runtime (defense-in-depth): SQL that bypassed
 * `generate` (e.g. hand-written migrations) is still made DSQL-compatible before
 * validation and execution.
 */
async function runSqlMigration(client: PoolClient, filePath: string, file: string): Promise<void> {
  const content = transformSql(fs.readFileSync(filePath, 'utf8'));
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

async function runModuleMigration(client: PoolClient, filePath: string): Promise<void> {
  const mod = await import(filePath);
  if (typeof mod.default !== 'function') {
    throw new Error(`Module migration ${filePath} must export a default async function(client: PoolClient)`);
  }
  try {
    await mod.default(client);
  } catch (error) {
    // Safety net: ROLLBACK any open transaction left by user code
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
