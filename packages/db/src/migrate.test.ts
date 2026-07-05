import { describe, expect, test, vi, beforeEach } from 'vitest';
import { migrate } from './migrate';
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
});
