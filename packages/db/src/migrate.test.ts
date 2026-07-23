import { describe, expect, test, vi, beforeEach } from 'vitest';
import { migrate, connectWithRetry, isTransientConnectError } from './migrate';
import type { Pool, PoolClient } from 'pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qr = (rows: any[] = []) => ({ rows, command: '', rowCount: 0, oid: 0, fields: [] }) as never;

function createMockClient() {
  const queries: string[] = [];
  const migrationsTable = new Map<string, { executed_at: number }>();
  let shouldFailNext: { message: string } | null = null;

  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push(sql);

      if (shouldFailNext) {
        const err = shouldFailNext;
        shouldFailNext = null;
        throw new Error(err.message);
      }

      if (sql.includes('SELECT 1 FROM _migrations') && params?.[0]) {
        const name = params[0] as string;
        return qr(migrationsTable.has(name) ? [{ '1': 1 }] : []);
      }

      if (sql.includes('INSERT INTO _migrations') && params) {
        migrationsTable.set(params[0] as string, { executed_at: params[1] as number });
        return qr();
      }

      return qr();
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return { client, queries, migrationsTable };
}

function createMockPool(client: PoolClient): Pool {
  return { connect: vi.fn(async () => client) } as unknown as Pool;
}

/** Zero-delay sleep for retry tests; production defaults would blow up unit-test wall time. */
const zeroSleep = () => Promise.resolve();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
    },
  };
});

import fs from 'node:fs';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrate', () => {
  test('M1: creates _migrations table on first run', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
    const { client, queries } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(queries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS _migrations'))).toBe(true);
  });

  test('M2: applies migration with BEGIN/COMMIT per statement', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "T" ("id" text PRIMARY KEY);');
    const { client, queries, migrationsTable } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(queries).toContain('BEGIN');
    expect(queries).toContain('CREATE TABLE "T" ("id" text PRIMARY KEY);');
    expect(queries).toContain('COMMIT');
    expect(migrationsTable.has('0001.sql')).toBe(true);
  });

  test('M3: skips already applied migration', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    const { client, queries, migrationsTable } = createMockClient();
    migrationsTable.set('0001.sql', { executed_at: Date.now() });
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(queries.filter((q) => q === 'BEGIN')).toHaveLength(0);
  });

  test('M4: skips applied migration even if content changed (no hash check)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CHANGED CONTENT');
    const { client, migrationsTable } = createMockClient();
    migrationsTable.set('0001.sql', { executed_at: Date.now() });
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).resolves.toBeUndefined();
  });

  test('M5: skips already exists error', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "T" ("id" text);');
    const { client, migrationsTable } = createMockClient();
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN') callCount++;
      if (sql.startsWith('CREATE TABLE') && callCount === 1) {
        throw new Error('relation "T" already exists');
      }
      if (sql.includes('SELECT 1 FROM _migrations') && params?.[0]) return qr([]);
      if (sql.includes('INSERT INTO _migrations') && params) {
        migrationsTable.set(params[0] as string, { executed_at: params[1] as number });
      }
      return qr();
    });
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).resolves.toBeUndefined();
    expect(migrationsTable.has('0001.sql')).toBe(true);
  });

  test('M6: throws on non-already-exists DDL error', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "T" ("id" text);');
    const { client } = createMockClient();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    vi.mocked(client.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('CREATE TABLE')) throw new Error('syntax error');
      if (sql.includes('SELECT 1 FROM _migrations') && params?.[0]) return qr([]);
      return qr();
    });
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'syntax error',
    );
  });

  test('M7: CREATE INDEX without ASYNC is auto-transformed at runtime (C2b)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE INDEX "idx" ON "T" ("col");');
    const { client, queries } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).resolves.toBeUndefined();
    // transformSql runs at migration time, so the applied statement carries ASYNC.
    expect(queries).toContain('CREATE INDEX ASYNC "idx" ON "T" ("col");');
  });

  test('M7a: inline REFERENCES is stripped at runtime (C2b)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ADD COLUMN "userId" text REFERENCES "User"("id");');
    const { client, queries } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).resolves.toBeUndefined();
    expect(queries).toContain('ALTER TABLE "T" ADD COLUMN "userId" text;');
  });

  test('M7b: rejects ALTER COLUMN TYPE', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ALTER COLUMN "c" TYPE varchar');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'ALTER COLUMN TYPE',
    );
  });

  test('M7c: rejects DROP COLUMN', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" DROP COLUMN "c"');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'DROP COLUMN',
    );
  });

  test('M7d: rejects SET NOT NULL', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ALTER COLUMN "c" SET NOT NULL');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'SET NOT NULL',
    );
  });

  test('M7e: rejects DROP NOT NULL', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ALTER COLUMN "c" DROP NOT NULL');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'DROP NOT NULL',
    );
  });

  test('M7f: rejects SET DEFAULT', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ALTER COLUMN "c" SET DEFAULT \'x\'');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'SET DEFAULT',
    );
  });

  test('M7g: rejects DROP DEFAULT', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" ALTER COLUMN "c" DROP DEFAULT');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'DROP DEFAULT',
    );
  });

  test('M7h: rejects DROP CONSTRAINT', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('ALTER TABLE "T" DROP CONSTRAINT "c_unique"');
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).rejects.toThrow(
      'DROP CONSTRAINT',
    );
  });

  test('M8: executes files in sorted order', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0002.sql', '0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const name = String(filePath);
      if (name.includes('0001')) return 'CREATE TABLE "A" ("id" text PRIMARY KEY);';
      return 'CREATE TABLE "B" ("id" text PRIMARY KEY);';
    });
    const { client, queries } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    const ddls = queries.filter((q) => q.startsWith('CREATE TABLE'));
    expect(ddls[0]).toContain('"A"');
    expect(ddls[1]).toContain('"B"');
  });

  test('M9: empty migrations directory succeeds', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
    const { client } = createMockClient();
    await expect(migrate({ pool: createMockPool(client), migrationsDir: '/migrations' })).resolves.toBeUndefined();
  });

  test('M10: multiple statements split by blank line', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'CREATE TABLE "A" ("id" text PRIMARY KEY);\n\nCREATE TABLE "B" ("id" text PRIMARY KEY);\n\nCREATE INDEX ASYNC "idx" ON "A" ("id");',
    );
    const { client, queries } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(queries.filter((q) => q === 'BEGIN')).toHaveLength(3);
  });

  test('M11: partial apply — skips applied, runs new', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql', '0002.sql'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "X" ("id" text PRIMARY KEY);');
    const { client, queries, migrationsTable } = createMockClient();
    migrationsTable.set('0001.sql', { executed_at: Date.now() });
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(queries.filter((q) => q === 'BEGIN')).toHaveLength(1);
    expect(migrationsTable.has('0002.sql')).toBe(true);
  });

  test('M12: .mjs migration executes default export', async () => {
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const fsMod = await import('node:fs');
    const tmpDir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'migrate-test-'));
    fsMod.writeFileSync(
      pathMod.join(tmpDir, '0001.mjs'),
      'export default async function(client) { await client.query("SELECT 1"); };',
    );

    vi.mocked(fs.readdirSync).mockImplementation(
      (...args: unknown[]) => fsMod.readdirSync(args[0] as string) as unknown as ReturnType<typeof fs.readdirSync>,
    );
    vi.mocked(fs.readFileSync).mockImplementation((...args: unknown[]) =>
      fsMod.readFileSync(args[0] as string, args[1] as BufferEncoding),
    );

    const { client, migrationsTable } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: tmpDir });
    expect(migrationsTable.has('0001.mjs')).toBe(true);
    fsMod.rmSync(tmpDir, { recursive: true });
  });

  test('M13: .sql and .mjs files sorted together', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0003.sql', '0001.sql', '0002.mjs'] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "X" ("id" text PRIMARY KEY);');
    const { client, migrationsTable } = createMockClient();
    migrationsTable.set('0002.mjs', { executed_at: Date.now() });
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(migrationsTable.has('0001.sql')).toBe(true);
    expect(migrationsTable.has('0003.sql')).toBe(true);
  });

  test('M14: .ts migration files are ignored (unsupported format)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['0001.sql', '0002.ts'] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE "X" ("id" text PRIMARY KEY);');
    const { client, migrationsTable } = createMockClient();
    await migrate({ pool: createMockPool(client), migrationsDir: '/migrations' });
    expect(migrationsTable.has('0001.sql')).toBe(true);
    expect(migrationsTable.has('0002.ts')).toBe(false);
  });

  test('M15: module migration receives the injected context as second argument', async () => {
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const fsMod = await import('node:fs');
    const tmpDir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'migrate-test-'));
    // The .mjs echoes context.region into a query so the test can observe it was passed through.
    fsMod.writeFileSync(
      pathMod.join(tmpDir, '0001.mjs'),
      "export default async function(client, context) { await client.query('CTX:' + (context?.region ?? 'none')); };",
    );

    vi.mocked(fs.readdirSync).mockImplementation(
      (...args: unknown[]) => fsMod.readdirSync(args[0] as string) as unknown as ReturnType<typeof fs.readdirSync>,
    );
    vi.mocked(fs.readFileSync).mockImplementation((...args: unknown[]) =>
      fsMod.readFileSync(args[0] as string, args[1] as BufferEncoding),
    );

    const { client, queries } = createMockClient();
    await migrate({
      pool: createMockPool(client),
      migrationsDir: tmpDir,
      context: { region: 'us-test-1' },
    });
    expect(queries).toContain('CTX:us-test-1');
    fsMod.rmSync(tmpDir, { recursive: true });
  });
});

describe('isTransientConnectError', () => {
  test('T1: identifies DSQL wake-up message as transient', () => {
    expect(
      isTransientConnectError(new Error('error: unable to accept connection, waking up cluster, please retry later')),
    ).toBe(true);
  });

  test('T2: identifies ECONNRESET as transient', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(isTransientConnectError(err)).toBe(true);
  });

  test('T3: identifies ETIMEDOUT as transient', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(isTransientConnectError(err)).toBe(true);
  });

  test('T4: does NOT flag auth errors (IAM token expired) as transient', () => {
    expect(isTransientConnectError(new Error('password authentication failed'))).toBe(false);
  });

  test('T5: does NOT flag DDL errors as transient', () => {
    expect(isTransientConnectError(new Error('relation "foo" already exists'))).toBe(false);
  });

  test('T6: safely handles non-Error values', () => {
    expect(isTransientConnectError('some string')).toBe(false);
    expect(isTransientConnectError(null)).toBe(false);
    expect(isTransientConnectError(undefined)).toBe(false);
  });
});

describe('connectWithRetry', () => {
  test('R1: succeeds on first attempt without retry', async () => {
    const { client } = createMockClient();
    const pool = createMockPool(client);

    const result = await connectWithRetry(pool, { sleepFn: zeroSleep });

    expect(result).toBe(client);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(1);
    // Priming SELECT 1 should have been issued
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
  });

  test('R2: retries on DSQL wake-up error at connect() and eventually succeeds', async () => {
    const { client } = createMockClient();
    let attempt = 0;
    const pool = {
      connect: vi.fn(async () => {
        attempt++;
        if (attempt <= 2) {
          throw new Error('error: unable to accept connection, waking up cluster, please retry later');
        }
        return client;
      }),
    } as unknown as Pool;

    const sleepFn = vi.fn(zeroSleep);
    const result = await connectWithRetry(pool, { sleepFn });

    expect(result).toBe(client);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  test('R3: destroys a client that fails SELECT 1 and retries with a fresh connection', async () => {
    const { client: goodClient } = createMockClient();
    const wakeUpError = new Error('unable to accept connection, waking up cluster, please retry later');

    let attempt = 0;
    // First client succeeds on connect but fails on SELECT 1; second client is fully healthy.
    const failingClient = {
      query: vi.fn(async () => {
        throw wakeUpError;
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    const pool = {
      connect: vi.fn(async () => {
        attempt++;
        if (attempt === 1) return failingClient;
        return goodClient;
      }),
    } as unknown as Pool;

    const sleepFn = vi.fn(zeroSleep);
    const result = await connectWithRetry(pool, { sleepFn });

    expect(result).toBe(goodClient);
    // Passing the error destroys the failed connection instead of returning it to the idle pool.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(failingClient.release).toHaveBeenCalledWith(wakeUpError);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  test('R4: retries on transient network error (ECONNRESET)', async () => {
    const { client } = createMockClient();
    let attempt = 0;
    const pool = {
      connect: vi.fn(async () => {
        attempt++;
        if (attempt === 1) {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        }
        return client;
      }),
    } as unknown as Pool;

    const sleepFn = vi.fn(zeroSleep);
    const result = await connectWithRetry(pool, { sleepFn });

    expect(result).toBe(client);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  test('R5: throws immediately on non-transient error (does not retry auth failure)', async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('password authentication failed for user "admin"');
      }),
    } as unknown as Pool;

    const sleepFn = vi.fn(zeroSleep);
    await expect(connectWithRetry(pool, { sleepFn })).rejects.toThrow('password authentication failed');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  test('R6: gives up after maxAttempts and rethrows the last transient error', async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('waking up cluster, please retry later');
      }),
    } as unknown as Pool;

    const sleepFn = vi.fn(zeroSleep);
    await expect(connectWithRetry(pool, { maxAttempts: 3, sleepFn })).rejects.toThrow('waking up cluster');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(3);
    // Between 3 attempts we expect 2 sleeps (one is skipped after the terminal failure).
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  test('R7: applies exponential backoff capped at maxDelayMs', async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('waking up cluster');
      }),
    } as unknown as Pool;

    const delays: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    await expect(
      connectWithRetry(pool, {
        maxAttempts: 6,
        initialDelayMs: 1000,
        maxDelayMs: 15000,
        sleepFn,
      }),
    ).rejects.toThrow('waking up cluster');

    // 1s, 2s, 4s, 8s, 15s (cap kicks in at attempt 5)
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000]);
  });

  test('R8: migrate() reuses connectWithRetry — first connect fails then succeeds', async () => {
    // Verifies that migrate() honours the retry path end-to-end.
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
    const { client } = createMockClient();
    let attempt = 0;
    const pool = {
      connect: vi.fn(async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('unable to accept connection, waking up cluster, please retry later');
        }
        return client;
      }),
    } as unknown as Pool;

    await expect(
      migrate({
        pool,
        migrationsDir: '/migrations',
        connectRetry: { sleepFn: zeroSleep },
      }),
    ).resolves.toBeUndefined();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });
});
