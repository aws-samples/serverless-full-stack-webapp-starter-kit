import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { transformSql, validateSql, validateStatement } from './dsql-compat';

const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

describe('transformSql', () => {
  test('T1: statement-breakpoint → blank line', () => {
    // drizzle-kit format: ";--> statement-breakpoint\n" (no newline before breakpoint)
    const input = 'CREATE TABLE "A" ("id" text);--> statement-breakpoint\nCREATE TABLE "B" ("id" text);';
    const result = transformSql(input);
    expect(result).not.toContain('statement-breakpoint');
    expect(result).toBe('CREATE TABLE "A" ("id" text);\n\nCREATE TABLE "B" ("id" text);');
  });

  test('T2: CREATE INDEX → CREATE INDEX ASYNC', () => {
    const result = transformSql(readFixture('add-index.input.sql'));
    expect(result).toBe(readFixture('add-index.expected.sql'));
  });

  test('T3: CREATE UNIQUE INDEX → CREATE UNIQUE INDEX ASYNC', () => {
    const input = 'CREATE UNIQUE INDEX "idx" ON "T" ("col");';
    const result = transformSql(input);
    expect(result).toBe('CREATE UNIQUE INDEX ASYNC "idx" ON "T" ("col");');
  });

  test('T4: already ASYNC INDEX is not double-transformed', () => {
    const input = 'CREATE INDEX ASYNC "idx" ON "T" ("col");';
    expect(transformSql(input)).toBe(input);
  });

  test('T5: inline REFERENCES removed, column definition preserved', () => {
    const result = transformSql(readFixture('add-fk-inline.input.sql'));
    expect(result).toBe(readFixture('add-fk-inline.expected.sql'));
  });

  test('T6: CONSTRAINT FOREIGN KEY line removed', () => {
    const result = transformSql(readFixture('add-fk-constraint.input.sql'));
    expect(result).toBe(readFixture('add-fk-constraint.expected.sql'));
  });

  test('T7: no-transform SQL passes through unchanged', () => {
    const input = readFixture('add-column.input.sql');
    expect(transformSql(input)).toBe(readFixture('add-column.expected.sql'));
  });

  test('T8: composite transform (breakpoint + INDEX + FK)', () => {
    const result = transformSql(readFixture('composite.input.sql'));
    expect(result).toBe(readFixture('composite.expected.sql'));
  });
});

describe('validateSql', () => {
  test('V1: ALTER COLUMN TYPE detected', () => {
    const errors = validateSql(readFixture('change-type.input.sql'));
    expect(errors.some((e) => e.pattern === 'ALTER COLUMN TYPE')).toBe(true);
  });

  test('V2: DROP COLUMN detected', () => {
    const errors = validateSql(readFixture('drop-column.input.sql'));
    expect(errors.some((e) => e.pattern === 'DROP COLUMN')).toBe(true);
  });

  test('V3: SERIAL detected', () => {
    const errors = validateSql(readFixture('serial.input.sql'));
    expect(errors.some((e) => e.pattern === 'SERIAL')).toBe(true);
  });

  test('V4: SET NOT NULL detected', () => {
    const errors = validateSql(readFixture('change-not-null.input.sql'));
    expect(errors.some((e) => e.pattern === 'SET NOT NULL')).toBe(true);
  });

  test('V5: DROP NOT NULL detected', () => {
    const errors = validateSql(readFixture('drop-not-null.input.sql'));
    expect(errors.some((e) => e.pattern === 'DROP NOT NULL')).toBe(true);
  });

  test('V6: SET DEFAULT detected', () => {
    const errors = validateSql(readFixture('set-default.input.sql'));
    expect(errors.some((e) => e.pattern === 'SET DEFAULT')).toBe(true);
  });

  test('V7: DROP DEFAULT detected', () => {
    const errors = validateSql(readFixture('drop-default.input.sql'));
    expect(errors.some((e) => e.pattern === 'DROP DEFAULT')).toBe(true);
  });

  test('V8: DROP CONSTRAINT detected', () => {
    const errors = validateSql(readFixture('drop-constraint.input.sql'));
    expect(errors.some((e) => e.pattern === 'DROP CONSTRAINT')).toBe(true);
  });

  test('V9: valid SQL has no errors', () => {
    const errors = validateSql(readFixture('add-column.input.sql'));
    expect(errors).toHaveLength(0);
  });

  test('V10: SQL comment with incompatible keyword is not flagged', () => {
    const errors = validateSql('-- ALTER TABLE TYPE comment\n\nALTER TABLE "T" ADD COLUMN "c" text;');
    expect(errors).toHaveLength(0);
  });

  test('V11: table name containing incompatible keyword is not flagged', () => {
    const errors = validateSql('CREATE TABLE IF NOT EXISTS "alter_type_log" (\n\t"id" uuid PRIMARY KEY\n);');
    expect(errors).toHaveLength(0);
  });

  test('V12: block comment with incompatible keyword is not flagged', () => {
    const errors = validateSql('/* DROP COLUMN workaround */\nALTER TABLE "T" ADD COLUMN "c" text;');
    expect(errors).toHaveLength(0);
  });

  test('V13: inline comment with incompatible keyword is not flagged', () => {
    const errors = validateSql('ALTER TABLE "T" ADD COLUMN "c" text; -- was DROP COLUMN but recreated');
    expect(errors).toHaveLength(0);
  });

  test('TRUNCATE detected', () => {
    const errors = validateSql(readFixture('truncate.input.sql'));
    expect(errors.some((e) => e.pattern === 'TRUNCATE')).toBe(true);
  });
});

describe('validateStatement', () => {
  test('throws on incompatible statement', () => {
    expect(() => validateStatement('ALTER TABLE "T" DROP COLUMN "c"', 'test.sql')).toThrow('DROP COLUMN');
  });

  test('does not throw on compatible statement', () => {
    expect(() => validateStatement('ALTER TABLE "T" ADD COLUMN "c" text', 'test.sql')).not.toThrow();
  });
});
