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

# 5. Verify snapshot chain integrity (also enforced in CI via check:ci)
pnpm run check:migrations   # drizzle-kit check — "Everything's fine"

# 6. Commit schema + migration + snapshot together
```

`generate` runs `drizzle-kit generate` then auto-transforms the output:

- `CREATE INDEX` → `CREATE INDEX ASYNC`
- Inline `REFERENCES` / `FOREIGN KEY` clauses removed
- `--> statement-breakpoint` → blank line (statement separator)

If the generated SQL contains unfixable patterns (e.g. `DROP COLUMN`, `ALTER COLUMN TYPE`), the script errors with instructions to use `drizzle-kit generate --custom` for manual table recreation.

## DSQL constraints enforced

**At lint time** (oxlint):

- `serial`, `smallserial`, `bigserial` imports from `drizzle-orm/pg-core` are blocked (DSQL has no sequences — use `uuid`/`text`). `json`/`jsonb` are allowed (compressed, 1 MiB compressed-size limit, **not indexable** — extract filtered/sorted fields into their own columns; prefer `jsonb`).

**At generate time** (check-dsql-compat):

- `ALTER COLUMN TYPE`, `DROP COLUMN`, `SET/DROP NOT NULL`, `SET/DROP DEFAULT`, `DROP CONSTRAINT`, `SERIAL`, `TRUNCATE`, `ADD COLUMN` with `DEFAULT`/`NOT NULL`/`CHECK`/`UNIQUE`/`PRIMARY KEY`

**At migration runtime** (validateStatement, after `transformSql`):

- All of the above, plus `CREATE INDEX` without `ASYNC`, `REFERENCES`, `FOREIGN KEY`

## Migration file formats

The default runner supports two formats, and both run **identically in local dev (tsx/node) and in the
Lambda migrator (node)** — there is no transpile step, so the file you commit is the file that runs.

- **`.sql`** — Split on blank lines (`\n\n`). Each statement runs in its own `BEGIN`/`COMMIT`.
  `transformSql` is applied at `generate` time and again at runtime (defense-in-depth).
- **`.mjs`** — Batch data migrations (e.g. table recreation, or backfills exceeding the
  3,000-row transaction limit). `export default async function(client, context)`. Use JSDoc for types:

  ```js
  // migrations/0002_backfill_example.mjs
  /**
   * @param {import('pg').PoolClient} client
   * @param {import('../src/migrate').MigrationContext} context
   */
  export default async function (client, context) {
    // context.region is available for constructing AWS SDK clients (e.g. an S3 backup).
    // 1 DDL per transaction; batch DML in <=3,000-row chunks.
    await client.query('BEGIN');
    await client.query(`UPDATE "TodoItem" SET "status" = 'PENDING' WHERE "status" IS NULL`);
    await client.query('COMMIT');
  }
  ```

The second argument, `context` (`MigrationContext`), is the seam for giving a migration access to AWS
resources without reading `process.env` ad hoc — e.g. writing a backup to S3 before an irreversible
change. It is empty by default (the sample app needs nothing). To wire a resource: add a field to
`MigrationContext` (`src/migrate.ts`), populate it in `migrate-cli.ts` (local) and the migrator handler
(Lambda), and grant the migrator matching IAM in the `DsqlMigrator` construct. Migrations that don't need
it ignore the argument (`function(client)` stays valid).

`.ts` is **not** supported by the default runner: it copies `migrations/` verbatim with no transpile
step, so one committed file runs unchanged both locally and in Lambda, keeping the runner free of
double-execution hazards. If your data migrations outgrow `.mjs` — large, multi-file, and
verification-heavy enough that type-safe authoring materially reduces risk — adding `.ts` back is a
legitimate choice, not an anti-pattern. The safe shape: commit a single `.ts` source, transpile it to
`.mjs` at Docker build (delete the `.ts` from the image so Lambda runs only `.mjs`), and make the
`_migrations` ledger key extension-agnostic so the local `.ts` and the deployed `.mjs` are not
double-applied.

## When `generate` fails with unfixable errors

The script cannot auto-fix destructive schema changes. Follow the steps printed in the error:

```bash
git checkout -- migrations/                                          # discard generated files
pnpm exec drizzle-kit generate --custom --name=<migration-name>      # empty migration + updated snapshot
# Write table recreation SQL (.sql) or batch migration (.mjs) in the generated file
pnpm run migrate
```

After adding a custom migration, always verify the snapshot is in sync:

```bash
pnpm run generate          # should print "nothing to migrate"
pnpm run check:migrations  # drizzle-kit check — validates the snapshot chain
```

`check:migrations` (`drizzle-kit check`) is also run in CI via `check:ci`. It detects a
**forked snapshot chain** — two snapshots sharing the same `prevId` (a "collision") — which
aborts `generate` entirely. This happens when custom/hand-authored migrations bypass the
`generate` / `generate --custom` flow and let the `meta/` chain diverge. If `check` reports a
collision, relink the offending snapshot's `prevId` to its true parent (the previous
snapshot's `id`) so the chain is linear again, then confirm both commands above pass.

CI additionally runs a **migration drift check**: it runs `generate` and fails if
`packages/db/migrations` changes — catching the case where `schema.ts` was edited but the
migrations were not regenerated (`generate` is DB-less and runs non-interactively in CI).

If `generate` instead generates an unexpected `.sql` file, the `meta/` snapshot has diverged from `schema.ts`. To fix:

1. Keep the generated `meta/NNNN_snapshot.json` — it reflects `schema.ts` accurately
2. Delete the unwanted `.sql`: `rm migrations/NNNN_xxx.sql`
3. In `meta/_journal.json`, change the latest entry's `tag` to match your custom migration filename (without extension)
4. Run `pnpm run generate` again — confirm "nothing to migrate"

## Table recreation (`.mjs`)

DSQL can't `DROP COLUMN`, `ALTER COLUMN TYPE`, or change `NOT NULL`/`DEFAULT`/constraints in place.
To make such a change, recreate the table with a `.mjs` migration. The pattern below is idempotent
(safe to re-run) and verifies row counts before swapping, so a failure leaves the original intact:

```js
// migrations/0003_recreate_todoitem.mjs
/** @param {import('pg').PoolClient} client */
export default async function (client) {
  // 1. Idempotency guard: skip if already recreated (e.g. the doomed column is gone).
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'TodoItem' AND column_name = 'legacyColumn'`,
  );
  if (rows[0].n === 0) return;

  // 2. Create the new table with the desired shape (its own DDL transaction).
  await client.query('BEGIN');
  await client.query(`CREATE TABLE "TodoItem_v2" (/* ...new shape... */)`);
  await client.query('COMMIT');

  // 3. Copy rows in <=3,000-row batches. WHERE NOT EXISTS makes each batch resumable.
  for (;;) {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO "TodoItem_v2" (/* cols */)
         SELECT /* cols */ FROM "TodoItem" old
         WHERE NOT EXISTS (SELECT 1 FROM "TodoItem_v2" v WHERE v.id = old.id)
         LIMIT 2000`,
    );
    await client.query('COMMIT');
    if ((res.rowCount ?? 0) < 2000) break;
  }

  // 4. Verify counts; abort (leaving the original untouched) on mismatch.
  const [oldC, newC] = await Promise.all([
    client.query(`SELECT COUNT(*)::int AS n FROM "TodoItem"`),
    client.query(`SELECT COUNT(*)::int AS n FROM "TodoItem_v2"`),
  ]);
  if (oldC.rows[0].n !== newC.rows[0].n) {
    await client.query(`DROP TABLE "TodoItem_v2"`);
    throw new Error('row count mismatch — aborting, original table untouched');
  }

  // 5. Swap via RENAME (each RENAME is its own DDL transaction). Keep the old table as
  //    `_old` and drop it in a later migration once you are confident.
  await client.query('BEGIN');
  await client.query(`ALTER TABLE "TodoItem" RENAME TO "TodoItem_old"`);
  await client.query('COMMIT');
  await client.query('BEGIN');
  await client.query(`ALTER TABLE "TodoItem_v2" RENAME TO "TodoItem"`);
  await client.query('COMMIT');
}
```

## Do not

- **Do not use `drizzle-kit push` or `drizzle-kit migrate`** — they run all DDL in one transaction. DSQL requires 1 DDL per transaction. Use `pnpm run migrate` (custom runner).
- **Do not edit applied migration files** expecting re-execution — the runner skips by name, not by content hash.
- **Do not mix DDL and DML in the same transaction** in `.mjs` migrations — DSQL rejects this.

## `.mjs` migration caveats

- Lambda execution limit is 15 minutes. Migrations exceeding this need Step Functions (out of scope).
- DSQL transaction limit is 3,000 rows. Batch inserts/updates/deletes must commit in chunks.
- The migrator Dockerfile copies `migrations/` verbatim (`.sql` + `.mjs`); there is no transpile step.

## oxlint limitation

`no-restricted-syntax` (`.references()` detection in schema files) is configured in `oxlintrc.json` but **not yet supported by oxlint** (as of v1.56.0). The SQL-level `REFERENCES` / `FOREIGN KEY` validation in `check-dsql-compat` and `migrate` serves as the fallback.

## Environment

Create `.env` in this package (gitignored):

```
DSQL_ENDPOINT=<cluster>.dsql.<region>.on.aws
AWS_REGION=<region>
```

Or use `pnpm --filter @repo/db run cluster create --region <region>` to provision a dev cluster and write `.env` automatically.

## Testing

```bash
pnpm run test:unit                    # unit tests (no DB required)
pnpm run test:integ                   # integration tests (DSQL cluster required)
DSQL_ENDPOINT=... AWS_REGION=... \
  pnpm run test:integ                 # explicit env
```
