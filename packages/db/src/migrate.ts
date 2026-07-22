import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { transformSql, validateStatement } from './dsql-compat';
import { isMigrationFile } from './migration-files';

/**
 * Injected into `.mjs` data migrations as the second argument, so they can reach
 * AWS resources without reading `process.env` ad hoc — e.g. writing a backup to S3
 * before an irreversible table recreation. Empty by default (the sample app needs
 * nothing here). To wire a resource: add a field, populate it in `migrate-cli.ts`
 * (local) and the migrator handler (Lambda), and grant the migrator matching IAM
 * in the `DsqlMigrator` construct. `.mjs` migrations that don't need it ignore the
 * argument — `export default async function(client)` stays valid.
 */
export interface MigrationContext {
  /** AWS region for constructing SDK clients. Undefined in local unit tests. */
  readonly region?: string;
}

/**
 * Exponential-backoff retry for the initial DSQL connection.
 *
 * DSQL clusters go idle after inactivity. The first connect after idle returns
 * `unable to accept connection, waking up cluster, please retry later` — this is
 * documented transient behaviour, not a real failure. The same message can also
 * come from transient network errors (ECONNRESET/ETIMEDOUT) during token exchange.
 *
 * Production apps with steady traffic rarely see this because their DSQL cluster
 * stays warm. The kit is different: a starter template can sit idle for weeks
 * between deploys, so the wake-up path is guaranteed to hit the first migration
 * of the day. Defaults spread ~30 s across the 5 sleeps between 6 attempts
 * (1s + 2s + 4s + 8s + 15s), plus attempt latency.
 */
export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Injectable for tests. Defaults to `setTimeout`. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export interface MigrateOptions {
  pool: Pool;
  migrationsDir: string;
  context?: MigrationContext;
  connectRetry?: RetryOptions;
}

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 15_000;

// Node network error codes that surface as transient failures during IAM-authed connect.
const TRANSIENT_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'EPIPE']);

// Matches DSQL's documented wake-up response. Case-insensitive; DSQL currently returns
// `error: unable to accept connection, waking up cluster, please retry later` verbatim.
const TRANSIENT_MESSAGE_PATTERNS = [/waking up cluster/i, /unable to accept connection/i, /please retry later/i];

export function isTransientConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== undefined && TRANSIENT_ERROR_CODES.has(code)) return true;
  return TRANSIENT_MESSAGE_PATTERNS.some((p) => p.test(err.message));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect to DSQL with exponential-backoff retry on transient errors.
 * Runs a lightweight `SELECT 1` after connect to surface wake-up errors that
 * some pool implementations return only on the first query rather than at connect.
 * The primed client is returned so the caller can proceed directly.
 */
export async function connectWithRetry(pool: Pool, options: RetryOptions = {}): Promise<PoolClient> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleepFn ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      // Prime the connection: DSQL can accept the socket but reject the first query
      // during wake-up, so probe here rather than let CREATE TABLE surface the failure.
      await client.query('SELECT 1');
      return client;
    } catch (err) {
      lastErr = err;
      // Release the client if we got past connect() but SELECT 1 failed.
      if (client) {
        try {
          client.release();
        } catch {
          /* ignore */
        }
      }
      if (!isTransientConnectError(err) || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `DSQL connect attempt ${attempt}/${maxAttempts} failed with transient error: ${message}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export async function migrate({ pool, migrationsDir, context = {}, connectRetry }: MigrateOptions): Promise<void> {
  const client = await connectWithRetry(pool, connectRetry);
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
        await runModuleMigration(client, path.join(migrationsDir, file), context);
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

async function runModuleMigration(client: PoolClient, filePath: string, context: MigrationContext): Promise<void> {
  const mod = await import(filePath);
  if (typeof mod.default !== 'function') {
    throw new Error(`Module migration ${filePath} must export a default async function(client, context)`);
  }
  try {
    await mod.default(client, context);
  } catch (error) {
    // Safety net: ROLLBACK any open transaction left by user code
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
