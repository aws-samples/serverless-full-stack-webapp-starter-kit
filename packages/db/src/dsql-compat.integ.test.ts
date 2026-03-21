import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { transformSql, validateSql } from './dsql-compat';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function runCheckCompat(migrationsDir: string): { exitCode: number; errors: string[] } {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  let transformed = 0;
  const errors: string[] = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const original = fs.readFileSync(filePath, 'utf8');
    const sql = transformSql(original);
    if (sql !== original) {
      fs.writeFileSync(filePath, sql);
      transformed++;
    }
    for (const e of validateSql(sql)) {
      errors.push(`${file}: ${e.pattern}`);
    }
  }

  return { exitCode: errors.length > 0 ? 1 : 0, errors };
}

describe('check-dsql-compat integration', () => {
  test('C1: transforms drizzle-kit output', () => {
    const sqlFile = path.join(tmpDir, '0001.sql');
    fs.writeFileSync(
      sqlFile,
      'CREATE TABLE "T" ("id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"("id"));--> statement-breakpoint\nCREATE INDEX "T_userId_idx" ON "T" ("userId");',
    );

    const { exitCode } = runCheckCompat(tmpDir);
    expect(exitCode).toBe(0);

    const result = fs.readFileSync(sqlFile, 'utf8');
    expect(result).not.toContain('statement-breakpoint');
    expect(result).not.toContain('REFERENCES');
    expect(result).toContain('CREATE INDEX ASYNC');
  });

  test('C2: no-transform file unchanged', () => {
    // Clean up previous files
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));

    const sqlFile = path.join(tmpDir, '0002.sql');
    const content = 'ALTER TABLE "T" ADD COLUMN "name" text;\n';
    fs.writeFileSync(sqlFile, content);

    runCheckCompat(tmpDir);

    expect(fs.readFileSync(sqlFile, 'utf8')).toBe(content);
  });

  test('C3: unfixable pattern returns exit 1', () => {
    // Clean up previous files
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));

    const sqlFile = path.join(tmpDir, '0003.sql');
    fs.writeFileSync(sqlFile, 'ALTER TABLE "T" ALTER COLUMN "c" TYPE varchar(100);\n');

    const { exitCode, errors } = runCheckCompat(tmpDir);
    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes('ALTER COLUMN TYPE'))).toBe(true);
  });
});
