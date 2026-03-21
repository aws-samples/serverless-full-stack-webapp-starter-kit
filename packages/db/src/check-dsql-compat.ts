#!/usr/bin/env tsx
// CLI script: transform drizzle-kit generated SQL for DSQL compatibility, then validate.
// Pure logic lives in dsql-compat.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSql, validateSql } from './dsql-compat';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
let transformed = 0;
let hasErrors = false;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const original = fs.readFileSync(filePath, 'utf8');
  const sql = transformSql(original);

  if (sql !== original) {
    fs.writeFileSync(filePath, sql);
    console.log(`TRANSFORMED: ${file}`);
    transformed++;
  }

  const errors = validateSql(sql);
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`ERROR: ${file} — ${e.pattern}: ${e.message}`);
    }
    hasErrors = true;
  }
}

if (transformed > 0) console.log(`\n${transformed} file(s) auto-transformed for DSQL compatibility.`);
if (hasErrors) {
  console.error(
    `\nUnfixable error(s) detected. Steps:\n  1. Run: git checkout -- migrations/\n  2. Run: pnpm --filter @repo/db exec drizzle-kit generate --custom --name=<migration-name>\n  3. Write table recreation SQL/TS in the generated file\n  4. Run: pnpm --filter @repo/db run migrate`,
  );
  process.exit(1);
}
console.log('All migration files DSQL-compatible.');
