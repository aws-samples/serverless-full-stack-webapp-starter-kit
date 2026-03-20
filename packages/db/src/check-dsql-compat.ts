// Validate migration SQL files for DSQL compatibility.
// Run after drizzle-kit generate to catch incompatible DDL before commit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

const rules: { pattern: RegExp; message: string }[] = [
  { pattern: /CREATE\s+INDEX\s+(?!.*ASYNC)/i, message: 'CREATE INDEX must use ASYNC keyword' },
  { pattern: /REFERENCES\s+/i, message: 'FOREIGN KEY / REFERENCES not supported' },
  { pattern: /FOREIGN\s+KEY/i, message: 'FOREIGN KEY not supported' },
  { pattern: /ALTER\s+.*\s+TYPE\s+/i, message: 'ALTER COLUMN TYPE not supported' },
  { pattern: /DROP\s+COLUMN/i, message: 'DROP COLUMN not supported' },
  { pattern: /\bSERIAL\b/i, message: 'SERIAL types not supported (use UUID)' },
];

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
let errors = 0;

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  for (const { pattern, message } of rules) {
    if (pattern.test(content)) {
      console.error(`ERROR: ${file} — ${message}`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} DSQL compatibility error(s). Fix the SQL before committing.`);
  process.exit(1);
}
console.log('All migration files DSQL-compatible.');
