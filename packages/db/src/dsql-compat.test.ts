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

  test('T4b: USING btree removed from CREATE INDEX', () => {
    const input = 'CREATE INDEX "idx" ON "T" USING btree ("col");';
    expect(transformSql(input)).toBe('CREATE INDEX ASYNC "idx" ON "T" ("col");');
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

  // C3a: ADD COLUMN inline constraint detection
  test('V14: ADD COLUMN with DEFAULT detected', () => {
    const errors = validateSql('ALTER TABLE "T" ADD COLUMN "c" integer DEFAULT 0;');
    expect(errors.some((e) => e.pattern === 'ADD COLUMN with constraint')).toBe(true);
  });

  test('V15: ADD COLUMN with NOT NULL detected', () => {
    const errors = validateSql('ALTER TABLE "T" ADD COLUMN "c" text NOT NULL;');
    expect(errors.some((e) => e.pattern === 'ADD COLUMN with constraint')).toBe(true);
  });

  test('V16: plain ADD COLUMN (incl. jsonb) is not flagged', () => {
    expect(validateSql('ALTER TABLE "T" ADD COLUMN "c" jsonb;')).toHaveLength(0);
    expect(validateSql('ALTER TABLE "T" ADD COLUMN "priority" text;')).toHaveLength(0);
  });

  test('V17: CREATE TABLE with inline PRIMARY KEY / NOT NULL / DEFAULT is not flagged', () => {
    const errors = validateSql(
      'CREATE TABLE "T" (\n\t"id" uuid PRIMARY KEY,\n\t"title" text NOT NULL,\n\t"status" text DEFAULT \'PENDING\'\n);',
    );
    expect(errors).toHaveLength(0);
  });

  test('V17b: ADD COLUMN with a keyword-named quoted identifier is not flagged', () => {
    expect(validateSql('ALTER TABLE "T" ADD COLUMN "default" text;')).toHaveLength(0);
    expect(validateSql('ALTER TABLE "T" ADD COLUMN "unique" text;')).toHaveLength(0);
    expect(validateSql('ALTER TABLE "T" ADD COLUMN "check" text;')).toHaveLength(0);
  });

  // C3b: CREATE INDEX ASYNC detection must not false-negative on index names containing "async"
  test('V18: CREATE INDEX missing ASYNC whose name contains "async" is still flagged', () => {
    const errors = validateSql('CREATE INDEX "user_async_idx" ON "T" ("c");');
    expect(errors.some((e) => e.pattern === 'CREATE INDEX without ASYNC')).toBe(true);
  });

  test('V19: valid CREATE INDEX ASYNC whose name contains "async" is not flagged', () => {
    const errors = validateSql('CREATE INDEX ASYNC "user_async_idx" ON "T" ("c");');
    expect(errors.every((e) => e.pattern !== 'CREATE INDEX without ASYNC')).toBe(true);
  });
});

describe('validateStatement', () => {
  test('throws on incompatible statement', () => {
    expect(() => validateStatement('ALTER TABLE "T" DROP COLUMN "c"', 'test.sql')).toThrow('DROP COLUMN');
  });

  test('does not throw on compatible statement', () => {
    expect(() => validateStatement('ALTER TABLE "T" ADD COLUMN "c" text', 'test.sql')).not.toThrow();
  });

  test('throws on ADD COLUMN with DEFAULT', () => {
    expect(() => validateStatement('ALTER TABLE "T" ADD COLUMN "c" integer DEFAULT 0', 'test.sql')).toThrow(
      'ADD COLUMN with constraint',
    );
  });
});

// The DSQL foreign-key invariant is enforced authoritatively here (generated-DDL
// layer), not at the TypeScript source layer. The kit previously carried a
// no-restricted-syntax oxlint override that was silently no-op — see ADR-003.
// These tests lock in the actual guarantees the DDL layer must provide:
//   (1) transformSql removes every FK generation path from drizzle-kit output,
//       preserving the column definition itself.
//   (2) validateSql / validateStatement reject any residual REFERENCES /
//       FOREIGN KEY that slipped past transformSql (defence-in-depth).
//   (3) The end-to-end pipeline (transform then validate) accepts drizzle-kit
//       output that started with an FK and produces FK-free, DSQL-valid DDL.
describe('dsql-compat: FK / REFERENCES removal (invariants for ADR-003)', () => {
  test('FK1: transformSql removes inline REFERENCES and preserves the column definition', () => {
    // Typical shape drizzle-kit emits from `.references(() => users.id)`.
    const input = [
      'CREATE TABLE "t" (',
      '\t"id" text PRIMARY KEY NOT NULL,',
      '\t"userId" text NOT NULL REFERENCES "users"("id")',
      ');',
    ].join('\n');

    const result = transformSql(input);

    expect(result).not.toMatch(/REFERENCES/i);
    // Column definition itself is preserved.
    expect(result).toContain('"userId" text NOT NULL');
  });

  test('FK2: transformSql removes a standalone CONSTRAINT ... FOREIGN KEY line', () => {
    const input = [
      'CREATE TABLE "t" (',
      '\t"id" text PRIMARY KEY NOT NULL,',
      '\t"userId" text NOT NULL,',
      '\tCONSTRAINT "t_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "users"("id")',
      ');',
    ].join('\n');

    const result = transformSql(input);

    expect(result).not.toMatch(/FOREIGN\s+KEY/i);
    expect(result).not.toMatch(/REFERENCES/i);
    expect(result).toContain('"userId" text NOT NULL');
  });

  test('FK3: transformSql removes a FOREIGN KEY line without the CONSTRAINT keyword', () => {
    // drizzle-kit's `foreignKey()` helper can emit FOREIGN KEY lines without a
    // preceding CONSTRAINT clause. Covered by a separate regex branch in
    // dsql-compat.ts; regression tested here.
    const input = [
      'CREATE TABLE "t" (',
      '\t"id" text PRIMARY KEY NOT NULL,',
      '\t"userId" text NOT NULL,',
      '\tFOREIGN KEY ("userId") REFERENCES "users"("id")',
      ');',
    ].join('\n');

    const result = transformSql(input);

    expect(result).not.toMatch(/FOREIGN\s+KEY/i);
    expect(result).not.toMatch(/REFERENCES/i);
  });

  test('FK4: transformSql strips ON DELETE / ON UPDATE actions attached to inline REFERENCES', () => {
    const input = 'ALTER TABLE "t" ADD COLUMN "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;';
    const result = transformSql(input);
    expect(result).not.toMatch(/REFERENCES/i);
    expect(result).not.toMatch(/ON\s+DELETE/i);
    expect(result).toContain('"userId" text NOT NULL');
  });

  test('FK5: validateSql flags surviving REFERENCES as DSQL-incompatible', () => {
    // If a hand-written migration bypasses transformSql (or transformSql regresses),
    // the post-transform check must still catch REFERENCES so we never send FK DDL
    // to DSQL.
    const sql = 'CREATE TABLE "t" (\n\t"userId" text NOT NULL REFERENCES "users"("id")\n);';
    const errors = validateSql(sql);
    expect(errors.map((e) => e.pattern)).toContain('REFERENCES');
  });

  test('FK6: validateSql flags surviving FOREIGN KEY as DSQL-incompatible', () => {
    const sql = 'CREATE TABLE "t" (\n\tFOREIGN KEY ("userId") REFERENCES "users"("id")\n);';
    const errors = validateSql(sql);
    const patterns = errors.map((e) => e.pattern);
    expect(patterns).toContain('FOREIGN KEY');
  });

  test('FK7: validateStatement throws on a statement that still contains REFERENCES', () => {
    const stmt = 'CREATE TABLE "t" (\n\t"userId" text NOT NULL REFERENCES "users"("id")\n);';
    expect(() => validateStatement(stmt, 'test.sql')).toThrow(/REFERENCES|FOREIGN KEY/i);
  });

  test('FK8: full generate path (transform then validate) yields FK-free, valid DDL', () => {
    // End-to-end assertion: drizzle-kit output containing an FK survives
    // transform + validate to produce zero errors and no FK residue.
    const generated = [
      'CREATE TABLE "t" (',
      '\t"id" text PRIMARY KEY NOT NULL,',
      '\t"userId" text NOT NULL REFERENCES "users"("id")',
      ');',
    ].join('\n');

    const transformed = transformSql(generated);
    const errors = validateSql(transformed);

    expect(errors).toHaveLength(0);
    expect(transformed).not.toMatch(/REFERENCES|FOREIGN\s+KEY/i);
  });
});
