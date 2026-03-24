// Pure functions for DSQL compatibility: transform drizzle-kit output and validate SQL.

/**
 * Transform drizzle-kit generated SQL for DSQL compatibility.
 * - statement-breakpoint → blank line
 * - CREATE [UNIQUE] INDEX → CREATE [UNIQUE] INDEX ASYNC
 * - REFERENCES clause removal (preserves column definition)
 * - FOREIGN KEY constraint removal
 */
export function transformSql(sql: string): string {
  let result = sql;

  // statement-breakpoint → blank line separator for SQL splitting
  // drizzle-kit outputs: "...;--> statement-breakpoint\nNEXT STATEMENT"
  // We need: "...;\n\nNEXT STATEMENT" (blank line for split)
  result = result.replace(/--> statement-breakpoint\n/g, '\n\n');

  // CREATE [UNIQUE] INDEX → ASYNC (skip if already ASYNC)
  result = result.replace(/CREATE\s+(UNIQUE\s+)?INDEX(?!\s+ASYNC)/gi, (_match, unique) =>
    unique ? `CREATE UNIQUE INDEX ASYNC` : `CREATE INDEX ASYNC`,
  );

  // Remove standalone FOREIGN KEY constraint lines BEFORE inline REFERENCES removal.
  // The inline REFERENCES regex would strip the REFERENCES part, leaving a partial CONSTRAINT line.
  // Pattern: ,\n\tCONSTRAINT "..." FOREIGN KEY (...) REFERENCES "..."("...")
  result = result.replace(
    /,\n\s*CONSTRAINT\s+"[^"]+"\s+FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s*"[^"]*"\s*\("[^"]*"\)[^\n]*/gi,
    '',
  );
  // Pattern without CONSTRAINT keyword: ,\n\tFOREIGN KEY (...) REFERENCES "..."("...")
  result = result.replace(/,\n\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s*"[^"]*"\s*\("[^"]*"\)[^\n]*/gi, '');

  // Remove inline REFERENCES from column definitions, preserving the column itself.
  // e.g. "userId" text NOT NULL REFERENCES "User"("id") → "userId" text NOT NULL
  result = result.replace(/\s+REFERENCES\s+"[^"]+"\("[^"]+"\)/gi, '');

  return result;
}

interface ValidationError {
  pattern: string;
  message: string;
}

const UNFIXABLE_PATTERNS: { pattern: RegExp; name: string; message: string }[] = [
  { pattern: /ALTER\s+.*\s+TYPE\s+/i, name: 'ALTER COLUMN TYPE', message: 'Table recreation required.' },
  { pattern: /DROP\s+COLUMN/i, name: 'DROP COLUMN', message: 'Table recreation required.' },
  { pattern: /\bSERIAL\b/i, name: 'SERIAL', message: 'Use IDENTITY columns or UUID instead.' },
  { pattern: /\bSET\s+NOT\s+NULL\b/i, name: 'SET NOT NULL', message: 'Table recreation required.' },
  { pattern: /\bDROP\s+NOT\s+NULL\b/i, name: 'DROP NOT NULL', message: 'Table recreation required.' },
  { pattern: /\bSET\s+DEFAULT\b/i, name: 'SET DEFAULT', message: 'Table recreation required.' },
  { pattern: /\bDROP\s+DEFAULT\b/i, name: 'DROP DEFAULT', message: 'Table recreation required.' },
  { pattern: /DROP\s+CONSTRAINT/i, name: 'DROP CONSTRAINT', message: 'Table recreation required.' },
  { pattern: /\bTRUNCATE\b/i, name: 'TRUNCATE', message: 'Use DELETE FROM instead.' },
];

// Post-transform safety checks (should have been fixed by transform)
const POST_TRANSFORM_CHECKS: { pattern: RegExp; name: string; message: string }[] = [
  {
    pattern: /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!.*ASYNC)/i,
    name: 'CREATE INDEX without ASYNC',
    message: 'CREATE INDEX must use ASYNC keyword.',
  },
  { pattern: /REFERENCES\s+/i, name: 'REFERENCES', message: 'FOREIGN KEY / REFERENCES not supported.' },
  { pattern: /FOREIGN\s+KEY/i, name: 'FOREIGN KEY', message: 'FOREIGN KEY not supported.' },
];

/**
 * Strip SQL comments from a statement to avoid false positives in pattern matching.
 * Removes: line comments (-- ...), block comments, and inline comments.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments /* ... */
    .replace(/--[^\n]*/g, '') // line comments -- ...
    .trim();
}

/**
 * Validate SQL for DSQL compatibility. Returns errors for unfixable patterns.
 * Operates on already-transformed SQL.
 */
export function validateSql(sql: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const statements = sql
    .split('\n\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    const stripped = stripComments(stmt);
    if (stripped.length === 0) continue;

    for (const { pattern, name, message } of [...UNFIXABLE_PATTERNS, ...POST_TRANSFORM_CHECKS]) {
      if (pattern.test(stripped)) {
        errors.push({ pattern: name, message });
      }
    }
  }
  return errors;
}

/**
 * Validate a single SQL statement at migration runtime.
 * Throws on DSQL-incompatible patterns.
 */
export function validateStatement(statement: string, file: string): void {
  const stripped = stripComments(statement);
  if (stripped.length === 0) return;
  const allPatterns = [...UNFIXABLE_PATTERNS, ...POST_TRANSFORM_CHECKS];
  for (const { pattern, name, message } of allPatterns) {
    if (pattern.test(stripped)) {
      throw new Error(
        `DSQL incompatible SQL in ${file}: ${name} — ${message}\n  Statement: ${statement.slice(0, 200)}`,
      );
    }
  }
}
