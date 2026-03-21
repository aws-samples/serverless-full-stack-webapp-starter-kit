# @repo/db

Database schema, DSQL-compatible migration runner, and Drizzle ORM client for Aurora DSQL.

## Schema changes

```bash
# 1. Edit src/schema.ts

# 2. Generate migration SQL (auto-transforms for DSQL)
pnpm run generate

# 3. Review generated SQL in migrations/

# 4. Apply to dev cluster
pnpm run migrate

# 5. Commit schema + migration + snapshot together
```

`generate` runs `drizzle-kit generate` then auto-transforms the output:

- `CREATE INDEX` → `CREATE INDEX ASYNC`
- Inline `REFERENCES` / `FOREIGN KEY` clauses removed
- `--> statement-breakpoint` → blank line (statement separator)

If the generated SQL contains unfixable patterns (e.g. `DROP COLUMN`, `ALTER COLUMN TYPE`), the script errors with instructions to use `drizzle-kit generate --custom` for manual table recreation.

## DSQL constraints enforced

**At lint time** (oxlint):

- `serial`, `json`, `jsonb` imports from `drizzle-orm/pg-core` are blocked

**At generate time** (check-dsql-compat):

- `ALTER COLUMN TYPE`, `DROP COLUMN`, `SET/DROP NOT NULL`, `SET/DROP DEFAULT`, `DROP CONSTRAINT`, `SERIAL`, `TRUNCATE`

**At migration runtime** (validateStatement):

- All of the above, plus `CREATE INDEX` without `ASYNC`, `REFERENCES`, `FOREIGN KEY`

## Migration file formats

- **`.sql`** — Split on blank lines (`\n\n`). Each statement runs in its own `BEGIN`/`COMMIT`.
- **`.ts` / `.mjs`** — Must `export default async function(client: PoolClient)`. Used for batch data migrations exceeding 3,000 rows. In Lambda, `.ts` files must be pre-transpiled to `.mjs` via the Dockerfile.

## When `generate` fails with unfixable errors

The script cannot auto-fix destructive schema changes. Follow the steps printed in the error:

```bash
git checkout -- migrations/                                          # discard generated files
pnpm exec drizzle-kit generate --custom --name=<migration-name>      # empty migration + updated snapshot
# Write table recreation SQL (.sql) or batch migration (.ts) in the generated file
pnpm run migrate
```

## Do not

- **Do not use `drizzle-kit push` or `drizzle-kit migrate`** — they run all DDL in one transaction. DSQL requires 1 DDL per transaction. Use `pnpm run migrate` (custom runner).
- **Do not edit applied migration files** expecting re-execution — the runner skips by name, not by content hash.
- **Do not mix DDL and DML in the same transaction** in `.ts` migrations — DSQL rejects this.

## `.ts` migration caveats

- Lambda execution limit is 15 minutes. Migrations exceeding this need Step Functions (out of scope).
- DSQL transaction limit is 3,000 rows. Batch inserts must commit in chunks.
- In Lambda, `.ts` files are pre-transpiled to `.mjs` in the Dockerfile. The runner picks up `.mjs` at runtime.

## oxlint limitation

`no-restricted-syntax` (`.references()` detection in schema files) is configured in `oxlintrc.json` but **not yet supported by oxlint** (as of v1.56.0). The SQL-level `REFERENCES` / `FOREIGN KEY` validation in `check-dsql-compat` and `migrate` serves as the fallback.

## Environment

Create `.env` in this package (gitignored):

```
DSQL_ENDPOINT=<cluster>.dsql.<region>.on.aws
AWS_REGION=<region>
```

Or use `scripts/dsql.sh create --region <region>` from the repo root to provision a dev cluster and write `.env` automatically.

## Testing

```bash
pnpm run test:unit                    # unit tests (no DB required)
pnpm run test:integ                   # integration tests (DSQL cluster required)
DSQL_ENDPOINT=... AWS_REGION=... \
  pnpm run test:integ                 # explicit env
```
