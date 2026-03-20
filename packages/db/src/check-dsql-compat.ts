// Transform drizzle-kit generated SQL for DSQL compatibility, then validate.
// Automatically fixes what can be fixed, errors on what cannot.
//
// Auto-transforms:
//   - "--> statement-breakpoint" → blank line (runner splits on \n\n)
//   - "CREATE INDEX" → "CREATE INDEX ASYNC"
//   - Removes REFERENCES / FOREIGN KEY clauses
//
// Errors (cannot auto-fix):
//   - ALTER COLUMN TYPE
//   - DROP COLUMN
//   - SERIAL types
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
let transformed = 0;
let errors = 0;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const original = fs.readFileSync(filePath, 'utf8');
  let sql = original;

  // Auto-transform: statement-breakpoint → blank line
  sql = sql.replace(/--> statement-breakpoint\n/g, '\n');

  // Auto-transform: CREATE INDEX → CREATE INDEX ASYNC (skip if already ASYNC)
  sql = sql.replace(/CREATE\s+INDEX(?!\s+ASYNC)/gi, 'CREATE INDEX ASYNC');

  // Auto-transform: remove lines with REFERENCES or FOREIGN KEY
  sql = sql
    .split('\n')
    .filter((line) => !/REFERENCES\s+/i.test(line) && !/FOREIGN\s+KEY/i.test(line))
    .join('\n');

  if (sql !== original) {
    fs.writeFileSync(filePath, sql);
    console.log(`TRANSFORMED: ${file}`);
    transformed++;
  }

  // Validate: errors that cannot be auto-fixed
  const unfixable: { pattern: RegExp; message: string }[] = [
    { pattern: /ALTER\s+.*\s+TYPE\s+/i, message: 'ALTER COLUMN TYPE not supported' },
    { pattern: /DROP\s+COLUMN/i, message: 'DROP COLUMN not supported' },
    { pattern: /\bSERIAL\b/i, message: 'SERIAL types not supported (use UUID)' },
  ];
  for (const { pattern, message } of unfixable) {
    if (pattern.test(sql)) {
      console.error(`ERROR: ${file} — ${message}`);
      errors++;
    }
  }
}

if (transformed > 0) console.log(`\n${transformed} file(s) auto-transformed for DSQL compatibility.`);
if (errors > 0) {
  console.error(`\n${errors} unfixable error(s). These require manual migration scripts.`);
  process.exit(1);
}
console.log('All migration files DSQL-compatible.');
