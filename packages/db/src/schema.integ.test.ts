import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Temp fixtures dir for oxlint test files (cleaned up in afterAll)
const fixturesDir = path.join(__dirname, 'oxlint-fixtures');
const rootDir = path.resolve(__dirname, '..', '..', '..');
const oxlintConfig = path.join(rootDir, 'oxlintrc.json');

beforeAll(() => {
  fs.mkdirSync(fixturesDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(fixturesDir, { recursive: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(fixturesDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function runOxlint(filePath: string): { exitCode: number; output: string } {
  try {
    const output = execSync(`npx oxlint --config ${oxlintConfig} ${filePath}`, {
      encoding: 'utf8',
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { exitCode: e.status, output: (e.stdout || '') + (e.stderr || '') };
  }
}

describe('oxlint DSQL rules', () => {
  test('L1: serial import detected', () => {
    const file = writeFile('l1.ts', "import { serial } from 'drizzle-orm/pg-core';\n");
    const { output } = runOxlint(file);
    expect(output).toContain('no-restricted-imports');
  });

  test('L2: json import detected', () => {
    const file = writeFile('l2.ts', "import { json } from 'drizzle-orm/pg-core';\n");
    const { output } = runOxlint(file);
    expect(output).toContain('no-restricted-imports');
  });

  test('L3: jsonb import detected', () => {
    const file = writeFile('l3.ts', "import { jsonb } from 'drizzle-orm/pg-core';\n");
    const { output } = runOxlint(file);
    expect(output).toContain('no-restricted-imports');
  });

  test('L4: valid imports pass', () => {
    const file = writeFile('l4.ts', "import { text, uuid } from 'drizzle-orm/pg-core';\n");
    const { output } = runOxlint(file);
    expect(output).not.toContain('no-restricted-imports');
  });

  // no-restricted-syntax is not yet supported by oxlint (as of v1.56.0).
  // The rule is configured in oxlintrc.json for future compatibility.
  // These tests are skipped until oxlint adds support.
  test.skip('L5: .references() detected in schema.ts', () => {
    const file = writeFile(
      'schema.ts',
      [
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        "const users = pgTable('users', { id: text('id').primaryKey() });",
        "const t = pgTable('t', { userId: text('userId').references(() => users.id) });",
        '',
      ].join('\n'),
    );
    const { output } = runOxlint(file);
    expect(output).toContain('no-restricted-syntax');
  });

  test.skip('L6: .references() not detected in non-schema file', () => {
    const file = writeFile('actions.ts', "const x = { references: () => 'ok' };\nx.references();\n");
    const { output } = runOxlint(file);
    expect(output).not.toContain('no-restricted-syntax');
  });
});
