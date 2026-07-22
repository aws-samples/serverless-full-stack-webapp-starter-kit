# ADR-005: Unifying Migration File Formats (Removing `.ts`; `.sql` + `.mjs`)

## Status

Accepted (v3.0.0). This supersedes the decision in ADR-001, “Aurora DSQL + Drizzle ORM + Custom Migration Runner,”
to “support `.ts` migration files for batch data operations.”

## Context

The initial v3 migration runner accepted three formats under `migrations/`: `.sql` / `.ts` / `.mjs`,
and batch data migrations (table recreation and backfills exceeding 3,000 rows) could be written in `.ts`.

This design had structural flaws:

1. **The executed files diverge between local and Lambda.** The runner was intended to execute `.ts` with `tsx` in
   local development and `.mjs` in Lambda (Docker, Node runtime). The README also stated that “in Lambda, `.ts` is
   pre-transpiled to `.mjs` in the Dockerfile,” but the actual migrator Dockerfile only copies `migrations/` as-is and
   has no transpile step, so the documentation and implementation diverged. As a result, `.ts` migrations raise a
   SyntaxError when the Lambda Node runtime calls `import()`.

2. **The same migration can coexist in two formats.** This creates conditions for double execution. In a downstream
   repository after several months of production use, mechanisms were introduced to address this divergence: “remove
   extensions from the duplicate-execution prevention key in the `_migrations` ledger (`WHERE name = $1 OR name = $2`)”
   and “convert `.ts`→`.mjs` during the Docker build and remove `.ts`.” These are legitimate costs to make `.ts` work,
   but they are unnecessary complexity for the `.sql` that most kit users write and the small number of `.mjs` files.

The root cause is that “the same migration can exist in two formats: `.ts` (local) and `.mjs` (Lambda).”
In the default runner, a committed file should be executed **identically in both** local and Lambda,
without a transpile step. However, for users whose migrations become large-scale and multi-file, where type-safe
implementations substantially reduce risk, `.ts` is not prohibited; it is positioned as the escape hatch described below.

## Decision

**Limit the default canonical formats in `migrations/` to two: `.sql` (schema changes) and `.mjs` (batch data migrations).**
The default runner does not handle `.ts` (see the “Escape Hatch” section for when complexity exceeds `.mjs`).

- Align the runner's target extensions, the CDK migrator's migration content hash, and Docker packaging with
  `.sql`/`.mjs`. Do not include a transpile step (Docker raw copies `migrations/` and executes `.mjs` as-is).
- `.mjs` can be imported with `import()` unchanged by either `node` or `tsx`, so local and Lambda execute the same file.
  Provide type completion with JSDoc (`/** @param {import('pg').PoolClient} client */`).
- **The `.mjs` interface is `export default async function(client, context)`.** The second argument, `context`
  (`MigrationContext`), is an injection seam for data migrations that access AWS resources, such as taking an S3
  backup before a breaking change. It is empty by default, and the sample app requires nothing. To provide resources,
  add fields to `MigrationContext`, populate their values in `migrate-cli.ts` (local) and the migrator handler (Lambda),
  and grant the corresponding IAM permissions in the `DsqlMigrator` construct. A migration that does not use `context`
  may ignore the second argument (`function(client)` remains valid).
- The runner applies `transformSql` to `.sql` at runtime as well (defense in depth for hand-written SQL that does not go
  through `generate`).

## Escape Hatch: Adopting `.ts` When `.mjs` Is Not Enough

When a migration becomes large-scale, multi-file, or verification-focused (for example, dumping all tables to S3 and
verifying them with SHA-256 before conversion ahead of a breaking rename) and JSDoc-equipped `.mjs` files no longer
provide sufficient type safety or maintainability, adopting `.ts` is not an anti-pattern but a legitimate choice.
The recommended form in that case is as follows:

- **Use `.ts` as the single committed source.** Commit only one `migrations/NNNN_x.ts`, transpile it to `.mjs` with
  esbuild during the Docker build, and remove `.ts` from the image (Lambda executes only `.mjs`). Locally, `tsx` executes
  `.ts` directly. Place specific logic that you want to split into multiple files under `migrations/NNNN_x/`, import it
  relatively from the entrypoint, and inline it into the parent `.mjs` with `--bundle`.
- **Make the `_migrations` ledger key extension-agnostic.** Because the format divergence remains—`.ts` locally and
  `.mjs` in Lambda—remove extensions from the ledger's duplicate-detection key to prevent double execution of the same
  migration (`file.replace(/\.(sql|ts|mjs)$/, '')`). Also include `.ts` in the runner's target extensions and the CDK
  migrator's hash targets.
- **Constrain imports out of `migrations/`.** Prohibit relative imports that leave `migrations/`. Also disallow value
  imports from `@repo/**`, `drizzle-orm`, and `pg` in migration files (they cannot be resolved in the Lambda runtime).
  It is advisable to mechanically check these boundaries with lint.

Introduce this only when deciding to accept these costs (format divergence + extension-removal key + import boundary).
They are not built into the default runner from the start because doing so would permanently impose unnecessary complexity
on most users (`.sql`-centric with rare `.mjs`).

### Rejected alternatives

- **Transpile `.ts` and commit both the generated `.mjs` (authoring-only approach):** The runtime format becomes only
  `.mjs`, but two committed files, `.ts` (source) and `.mjs` (generated artifact), coexist, creating a substantial risk
  that they diverge through manual edits or similar changes. Prefer the single-source escape hatch above (commit only
  `.ts`).
- **Execute `.ts` in Lambda without conversion** (bundle `tsx` in the image / use Node's `--experimental-strip-types`):
  The former adds runtime dependencies and loader registration, and also bloats the image. The latter depends on an
  experimental flag, creating risks from Node minor-version differences and warning output. Both conflict with the kit's
  emphasis on reproducibility as a “copy and grow” kit.

## Consequences

- **There is no impact on `.sql` migrations or existing `.mjs` users.** Most migrations are `.sql` generated by
  drizzle-kit, and `.mjs` is limited to rare batch data migrations, so the impact is limited.
- The **default runner** has no format divergence, and the `_migrations` ledger key remains the full file name without
  ambiguity (1 migration = 1 file, 1 extension). A duplicate-execution prevention key based on extension removal is
  unnecessary unless `.ts` is introduced through the escape hatch.
- **The `context` injection seam allows data migrations that require AWS resources, such as external backups before
  breaking changes, to be implemented as `.mjs` without changing the file format.** Migration safety (format-independent
  idempotency, verification before swap, and external backups) is provided by this seam and how each migration is
  written, not by the file format.
- Documentation (`packages/db/README.md`, `AGENTS.md`) and the implementation (the fact that the Dockerfile raw copies)
  are aligned.

### Breaking change: Migration Steps for Existing v3 Users

If you already wrote batch data migrations in `.ts`, the following migration is required:

1. Rename `migrations/NNNN_x.ts` to `migrations/NNNN_x.mjs`.
2. Replace TypeScript type annotations with JSDoc (keep the form `export default async function(client)`.
   `import type { PoolClient }` is unnecessary; use `/** @param {import('pg').PoolClient} client */`).
3. If the migration is **not yet applied**, this completes the migration.
4. If the migration is **already applied**, care is required. The `_migrations` table records the old name, `NNNN_x.ts`.
   Because the runner determines whether to skip using the full file name, the renamed `NNNN_x.mjs` is
   **considered unapplied and is executed again**. To avoid double application of a data migration, before deployment,
   do one of the following in each environment:
   - Update the ledger name: `UPDATE _migrations SET name = 'NNNN_x.mjs' WHERE name = 'NNNN_x.ts';`
   - Alternatively, rewrite the migration to be idempotent, so it is safe to run again.

Because this kit follows a copy-and-grow model and has a limited number of early users, the extension-agnostic
backward-compatible key (adopted by the downstream app) is not introduced into the runner; the explicit migration
steps above are adopted instead. This prioritizes keeping the runner simple and the clarity of `_migrations` semantics
(the recorded file name = applied).
