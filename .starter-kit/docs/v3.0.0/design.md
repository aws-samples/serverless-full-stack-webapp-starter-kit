# v3.0.0 Design document

## Overview

v3 simultaneously changes the DB engine (Aurora Serverless v2 → Aurora DSQL), ORM (Prisma → Drizzle), package manager (npm → pnpm workspaces), and linter (ESLint + Prettier → oxlint + oxfmt). The four changes are interdependent, and resolving them together avoids wasting effort on intermediate states.

For the motivations for these changes, the rationale for the technology choices, and rejected alternatives, see the ADRs. This document describes the implementation details of the decisions made in the ADRs.

- [ADR-001: Aurora DSQL + Drizzle ORM + custom migration runner](adr-001-dsql-drizzle-migrator.md)
- [ADR-002: pnpm workspaces monorepo](adr-002-pnpm-workspaces.md)
- [ADR-003: oxlint + oxfmt](adr-003-oxlint-oxfmt.md)
- [ADR-004: Keeping the DSQL admin role](adr-004-dsql-admin-role.md)
- [ADR-005: Unified migration file formats (drop `.ts`, keep `.sql` + `.mjs`)](adr-005-migration-file-format.md)
- [ADR-006: Deploy-time image build via `ContainerImageBuild`](adr-006-deploy-time-image-build.md)
- [ADR-007: CloudFront flat-rate pricing plan compatibility](adr-007-cloudfront-flat-rate.md)

## Target architecture

```
pnpm-workspace.yaml
package.json                      # root (scripts and devDependencies only)
apps/
  cdk/                            # CDK infrastructure
  webapp/                         # Next.js app (no jobs or migration runner)
  async-job/                      # extracted from webapp/src/jobs/
  db-migrator/                    # Lambda migration runner
packages/
  db/                             # Drizzle schema, client, migration SQL, runner
  shared-types/                   # job payload types (Zod schemas)
  event-utils/                    # SigV4-signed utility for sending to AppSync Events
```

Dependency direction:

```
apps/webapp       → @repo/db, @repo/shared-types, @repo/event-utils
apps/async-job    → @repo/db, @repo/shared-types, @repo/event-utils
apps/cdk          → @repo/shared-types
```

Apps do not depend on one another. Internal packages also do not depend on one another. The scope for internal packages is `@repo/`.

## Aurora DSQL

### Connection pattern

DSQL accepts connections only through IAM authentication. `@aws/aurora-dsql-node-postgres-connector` automates IAM authentication token generation and passes the token to node-postgres. Reasons for choosing this connector:

- It is the official AWS Node.js connector and internally manages the 15-minute IAM token lifetime and refreshes.
- It provides `AuroraDSQLPool`, which extends the node-postgres (`pg`) `Pool` interface and can be passed directly to Drizzle ORM through `drizzle({ client: pool })`.
- It automatically uses IAM authentication from the execution role in a Lambda environment and AWS profile credentials in the local CLI.

`@aws/aurora-dsql-postgres-js-connector` (for Postgres.js) also exists, but using `AuroraDSQLPool` with Drizzle's node-postgres driver is simpler.

### DB roles and permission model

DSQL has a two-layer permission model that integrates PostgreSQL's role system with IAM:

- **admin role** (`dsql:DbConnectAdmin`): DDL + DML + role management. The only built-in role, automatically created when the cluster is created.
- **custom roles** (`dsql:DbConnect`): DML only. Create them by connecting as `admin` and running `CREATE ROLE ... WITH LOGIN` + `AWS IAM GRANT` + `GRANT ... ON ALL TABLES IN SCHEMA`.

In this kit, all Lambda functions (webapp, async-job, migrator) connect with the `admin` role. From a least-privilege perspective, webapp and async-job only need DML, but the ordering dependency between CDK and migrations (passing the Lambda execution role ARN) does not justify the added complexity for a starter kit, so the kit keeps `admin`. v2 also connected everything with the master user, and v3 has already improved the authentication layer by moving to IAM temporary tokens. For details, see [ADR-004](adr-004-dsql-admin-role.md).

### DDL constraints

Source: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/ (verified 2026-03-21)

> **Note:** These DSQL constraints are a point-in-time snapshot. Aurora DSQL continues to relax its limits (for example, `json`/`jsonb` were unsupported at launch and added in 2026), so verify the current constraints against the [Aurora DSQL documentation](https://docs.aws.amazon.com/aurora-dsql/) or the `dsql` agent skill before relying on them.

This section records the constraints that support design decisions. As numerical quotas (connection count, table count, and so on) may change, see the [official documentation](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html).

#### Transaction constraints

- DDL and DML require separate transactions.
- A transaction can contain only one DDL statement.
- A write transaction has a 3,000-row limit (applies to INSERT, UPDATE, and DELETE).
- A write transaction has a 10 MiB limit.
- The maximum transaction execution time is 5 minutes.
- The isolation level is fixed at Repeatable Read.
- OCC (optimistic concurrency control): returns a serialization error on a write conflict. The application layer must retry.

#### ALTER TABLE supported actions

Actions supported by ALTER TABLE are extremely limited. The following are all officially supported actions:

```sql
ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type
ALTER [ COLUMN ] column_name { SET GENERATED { ALWAYS | BY DEFAULT } | SET sequence_option | RESTART [...] }
ALTER [ COLUMN ] column_name DROP IDENTITY [ IF EXISTS ]
OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
RENAME [ COLUMN ] column_name TO new_column_name
RENAME CONSTRAINT constraint_name TO new_constraint_name
RENAME TO new_name
SET SCHEMA new_schema
```

Source: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html

All operations not included above (`DROP COLUMN`, `ALTER COLUMN TYPE`, `SET/DROP NOT NULL`, `SET/DROP DEFAULT`, and `DROP CONSTRAINT`) require table recreation. This constraint is the basis for the validation patterns in the migration runner and the unfixable workflow.

#### Unsupported data types

- `SERIAL` / `BIGSERIAL` / `SMALLSERIAL` — use an IDENTITY column or UUID.
- Array types (such as `TEXT[]`) — store in TEXT (array types are supported at query runtime).
- Custom types / ENUM types.
- Extension types such as PostGIS.

> `json` / `jsonb` are **available** because DSQL added support in 2026 (automatic compression, a 1 MiB post-compression limit, and **not indexable**). Extract values used as search or sort keys into independent columns. `jsonb` is recommended for semi-structured data.

#### SEQUENCE / IDENTITY column constraints

- Explicitly specifying `CACHE` is required (it is optional in PostgreSQL).
- Supported CACHE values: only `1` or `>= 65536` (intermediate values are not allowed).
- Only the `BIGINT` data type is supported.
- SERIAL types are unsupported → use `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY (CACHE ...)`.

#### Index constraints

- `CREATE INDEX ASYNC` is required (synchronous INDEX is not allowed).
- A maximum of 24 indexes per table.
- A maximum of 8 columns per index.

#### Other DDL constraints

- FOREIGN KEY is unsupported — enforce referential integrity at the application layer.
- TRUNCATE is unsupported — use `DELETE FROM` instead.
- Temporary tables are unsupported.
- Triggers are unsupported.
- PL/pgSQL is unsupported — SQL functions only.
- Extensions are unsupported (PostGIS, pgvector, and so on).

## Custom migration runner

For the rationale, see [ADR-001](adr-001-dsql-drizzle-migrator.md). The following is the implementation specification.

### Three-layer design

Each layer depends only on adjacent layers, with no dependencies that skip a layer:

- **Core logic** (`packages/db/src/migrate.ts`): Receives `pg.Pool` and applies files with supported extensions (`.sql` / `.mjs`) in name order. For `.sql`, transforms it to DSQL compatibility with `transformSql`, then splits it at blank lines (`\n\n`) and executes one statement at a time with `BEGIN`/`COMMIT` (runtime transformation provides defense in depth for handwritten SQL that bypasses generation-time transformation). For `.mjs`, calls the `default` export function (`export default async function(client, context)`). The optional second `context` argument may be omitted when unused. It has no dependency on CDK, Lambda, or Drizzle. It can be reused with any ORM or deployment tool.
- **Lambda handler** (`apps/db-migrator/src/handler.ts`): A thin wrapper that creates a Pool from Lambda environment variables and calls `migrate()`.
- **CDK Construct** (`apps/cdk/lib/constructs/dsql-migrator/index.ts`): Automatically runs during `cdk deploy` using a zip-packaged `NodejsFunction` + a CDK Trigger. esbuild bundles the handler and copies the entire `migrations/` directory to the asset root, so the standard asset hash captures migration changes. A changed asset creates a new Lambda `currentVersion`, whose version `HandlerArn` makes the Trigger rerun (see C1 in [ADR-001](adr-001-dsql-drizzle-migrator.md)).

This separation lets the core logic work with ORMs other than Drizzle, the Lambda handler work with deployment tools other than CDK, and the CDK Construct remain independent of how migration SQL is generated.

### Migration state management

The `_migrations` table (name = full file name, executed_at) tracks application state. Skip `already exists` errors for idempotency. Because one migration is one file with one extension, there is no ambiguity in name.

For why content-hash-based tampering detection was rejected (and how it differs from the zip asset hash that reruns deployments), see [Consequences in ADR-001](adr-001-dsql-drizzle-migrator.md).

### Automatic SQL transformation

`check-dsql-compat.ts` automatically transforms the output of drizzle-kit generate to DSQL compatibility. Transformation rules:

| Transformation            | Input pattern                                                     | Output                                                                                          |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Statement delimiter       | `--> statement-breakpoint\n`                                      | `\n\n` (blank line. The runner splits SQL at this blank line)                                   |
| INDEX → ASYNC             | `CREATE INDEX` / `CREATE UNIQUE INDEX`                            | `CREATE INDEX ASYNC` / `CREATE UNIQUE INDEX ASYNC` (does not transform if ASYNC already exists) |
| Remove CONSTRAINT FK line | `,\n  CONSTRAINT "..." FOREIGN KEY (...) REFERENCES "..."("...")` | Remove the entire line (including the comma)                                                    |
| Remove unnamed FK line    | `,\n  FOREIGN KEY (...) REFERENCES "..."("...")`                  | Remove the entire line                                                                          |
| Remove inline REFERENCES  | `"col" text NOT NULL REFERENCES "Table"("id")`                    | `"col" text NOT NULL` (remove only the REFERENCES part and retain the column definition)        |

FK removal has two patterns because drizzle-kit emits FKs in two forms: a CONSTRAINT line (an independent constraint definition at the end of `CREATE TABLE`) and inline REFERENCES (appended to the end of a column definition). Remove a CONSTRAINT line as a whole line, but remove only the REFERENCES part for inline REFERENCES to avoid breaking the column definition. Removal order is also important: unless CONSTRAINT lines are removed first, the inline REFERENCES regular expression also matches REFERENCES within CONSTRAINT lines, leaving incomplete lines behind.

### SQL validation

Before executing each SQL statement, the runner validates DSQL-incompatible patterns. It detects:

| Pattern                                                            | Reason                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `CREATE INDEX` without `ASYNC`                                     | DSQL does not permit synchronous INDEX                                            |
| `REFERENCES` / `FOREIGN KEY`                                       | DSQL does not support FK                                                          |
| `ALTER COLUMN ... TYPE` / `SET DATA TYPE`                          | Not included in the official ALTER TABLE syntax                                   |
| `DROP COLUMN`                                                      | Not included in the official ALTER TABLE syntax                                   |
| `SET NOT NULL` / `DROP NOT NULL`                                   | Not included in the official ALTER TABLE syntax                                   |
| `SET DEFAULT` / `DROP DEFAULT`                                     | Not included in the official ALTER TABLE syntax                                   |
| `DROP CONSTRAINT`                                                  | Not included in the official ALTER TABLE syntax                                   |
| `ADD COLUMN ... DEFAULT`/`NOT NULL`/`CHECK`/`UNIQUE`/`PRIMARY KEY` | DSQL ADD COLUMN cannot add constraints (add as nullable and backfill with UPDATE) |
| `SERIAL`                                                           | DSQL-unsupported type                                                             |
| `TRUNCATE`                                                         | DSQL unsupported. Use `DELETE FROM` instead                                       |

### .mjs migrations

Use these when table recreation (DROP COLUMN, ALTER COLUMN TYPE, and so on) or batched data migration exceeding 3,000 rows is required. Export `export default async function(client, context)`; the optional second `context` argument may be omitted when unused. Supplement types with JSDoc (`@param {import('pg').PoolClient} client`).

The only canonical formats in `migrations/` are `.sql` and `.mjs`; `.ts` is unsupported. The reason is that local (tsx/node) and Lambda (node) **execute the same files without transformation** — inserting a transpilation step causes files to diverge between local and deployed environments, creating the conditions for double execution (for details, see [ADR-005](adr-005-migration-file-format.md)).

Constraints:

- Lambda's maximum execution time is 15 minutes. Migrations exceeding it require a separate mechanism such as Step Functions (outside the runner's scope).
- The migrator is a zip-packaged `NodejsFunction`; its esbuild `afterBundling` hook copies the entire `migrations/` directory into the Lambda asset unchanged (no transpilation step).

### Workflow for unfixable patterns

When `drizzle-kit generate` produces DSQL-incompatible SQL, `check-dsql-compat.ts` detects the error and guides the following procedure:

1. Restore generated output with `git checkout -- migrations/`.
2. Generate an empty migration file and an updated snapshot with `drizzle-kit generate --custom --name=<name>`.
3. Write table recreation in `.sql` (3,000 rows or fewer) or `.mjs` (batched migration).
4. Apply it with `pnpm --filter @repo/db run migrate`.

For why the runner does not automatically roll back on errors, see [Consequences in ADR-001](adr-001-dsql-drizzle-migrator.md).

### CI validation of migration consistency

CI validates two types of consistency:

- **Chain consistency** (`check:migrations` in `packages/db`'s `check:ci` = `drizzle-kit check`): Detects snapshot-chain forks (duplicate `prevId`) and divergence from `schema.ts`.
- **Generate drift** (an independent step in `.github/workflows/build.yml`): Runs `generate` and fails if it produces differences in `migrations/` (detects cases where `schema.ts` changes without generate). `generate` runs without a DB connection and non-interactively (closes stdin to prevent CI from hanging at a rename prompt).

## DSQL compatibility strategy

Detect DSQL-incompatible patterns at two stages: coding time and migration time.

**Layer 1 — oxlint (schema-definition level)**: `no-restricted-imports` blocks imports of `serial`, `smallserial`, and `bigserial` from `drizzle-orm/pg-core` (`json`/`jsonb` are allowed because DSQL supports them). This provides immediate feedback in the editor and CI. (`.references()` / foreign keys are not linted: oxlint's `no-restricted-syntax` was a no-op and has been removed. FK removal is enforced at the generated-SQL level by `dsql-compat.ts`. See [ADR-003](adr-003-oxlint-oxfmt.md) for details.)

**Layer 2 — SQL validation (generated-SQL level)**: `check-dsql-compat.ts` automatically transforms drizzle-kit output and validates patterns that cannot be automatically fixed.

Why two layers: let oxlint handle what it can detect, and limit SQL regular expressions to “problems at the generated-SQL level that cannot be detected in the TypeScript world.” Do not prohibit adding or removing `notNull()` or `default()` in lint: it cannot distinguish legitimate use on a new column from an incompatible change to an existing column. Detect these at the generated-SQL level (`SET NOT NULL`, `DROP DEFAULT`, and so on).

## pnpm workspaces + Docker build

For the rationale, see [ADR-002](adr-002-pnpm-workspaces.md). The following describes implementation constraints and mitigations.

### Remote builds with ContainerImageBuild

Build the webapp and async-job container images with `ContainerImageBuild` from `@cdklabs/deploy-time-build`. The dsql-migrator is a zip-packaged `NodejsFunction`; do not use `DockerImageCode.fromImageAsset` (local Docker builds).

Motivation: eliminate local Docker as a deployment-time dependency. This removes the need to set up Docker Desktop on Windows or Docker-in-Docker in CI environments, so Docker can be removed from Prerequisites.

Mechanism: during `cdk deploy`, a CloudFormation custom resource builds images with CodeBuild (ARM/Small) and pushes them to ECR. `ContainerImageBuild` instances in the same stack and architecture share one CodeBuild project through `SingletonProject`.

Trade-offs:

- Docker layer caching does not work (a full build occurs every time).
- The default concurrent-build quota for CodeBuild ARM/Small is one, so multiple builds queue and run serially. You can increase it in Service Quotas.

### Script conventions

Each subpackage defines the task names it needs (commonly `lint` and `check:ci`, plus `build`/`test:unit`/`dev` where applicable) in its own `package.json`; run them together from the root with `pnpm -r run <task>`. Do not add alias scripts for these tasks to the root `package.json`: it is redundant because each package owns its own scripts, and indirect calls with `--if-present` make debugging difficult.

The pre-commit hook uses `simple-git-hooks` + `lint-staged`: it runs oxlint/oxfmt on staged files, then runs `test:unit` for all packages. The `prepare` script automatically installs the hook during `pnpm install`. The oxlint invocation in lint-staged cannot type check through `typeCheck`: lint-staged passes only staged files as arguments, which is incompatible with type checking that requires resolving tsconfig for the entire project. CI's `check:ci` (`typeCheck: true` in `oxlintrc.json`) ensures type checking.

### Docker build constraints

Docker builds in strict mode have four pitfalls (see [Consequences in ADR-002](adr-002-pnpm-workspaces.md) for details):

1. The Docker `pnpm install` is unfiltered: install the whole workspace with `pnpm install --frozen-lockfile` (no `--filter`). This concerns the _install_ only — `pnpm --filter <pkg> run <script>` for task scoping is used normally. pnpm's isolated `node_modules` exposes only declared deps, so `esbuild` / `next build` need the full transitive graph on disk; a scoped install can miss transitive deps and gains nothing because the builder's `node_modules` is discarded (the runtime image copies only the bundle).
2. CDK's Docker image asset does read `.dockerignore` and auto-excludes `cdk.out`, but by default interprets exclude patterns with GLOB semantics; with the repo root as build context, set `ignoreMode: IgnoreMode.DOCKER` so `.dockerignore` is interpreted with Docker semantics and the deep pnpm `node_modules` tree is not staged (applies to `ContainerImageBuild` / `DockerImageAsset`).
3. esbuild output using `--format=esm` requires a `.mjs` extension in Lambda.
4. `--external:@aws-sdk/*` does not exclude `@aws/*` packages.

## ESM eager evaluation and Proxy lazy initialization

`client.ts` combines Proxy-based lazy initialization and a `globalThis` singleton to solve two problems.

1. **Avoid ESM eager evaluation (Proxy)**: In ESM, top-level `export const db = drizzle(...)` is evaluated immediately when the module is imported. Merely having `cli.ts` run `import { getPool } from './client'` also initializes `db`, causing a crash when `DSQL_ENDPOINT` is unset. Using a Proxy defers initialization until actual property access without changing existing code that imports `db`. A function-wrapping approach (`getDb()`) was also considered but rejected because it would require changing every call site.
2. **Prevent connection leaks during Next.js hot reload (`globalThis`)**: The Next.js dev server reevaluates modules, so without retaining the instance on `globalThis`, a new connection pool is created and leaked on every reload. Using a `globalThis` singleton as the target of Proxy lazy initialization solves both problems at once.

## Test design

Tests for the migration runner and the DSQL compatibility check use a two-layer, fixture-based design.

### Fixture-based tests

Regular-expression operations on SQL strings risk false positives (raising errors for valid SQL) and false negatives (missing incompatible SQL). Because inputs are limited to “output from drizzle-kit generate,” use actual output as fixtures. Each fixture is an `input.sql` / `expected.sql` pair that explicitly verifies transformation input and output.

### Separation of unit and integration tests

- **unit tests**: Mock `pg.Pool` and the file system. They run immediately without a DB. They ensure comprehensive pattern coverage for transformation logic and validation.
- **integration tests**: Run against a real DSQL cluster. They prove that transformed SQL works on DSQL, verify idempotency, and confirm the actual behavior of skipping `already exists`. They run only when the `DSQL_ENDPOINT` environment variable is set.

This separation provides fast feedback in CI using only unit tests, while developers run integration tests that require a DSQL cluster in their local environment.

### Integration test isolation strategy

To avoid polluting the production `migrations/` directory, integration tests create a temporary migrations directory under `os.tmpdir()` and place test SQL there. Before each test, clean up the target tables and the `_migrations` table with `DROP TABLE IF EXISTS` to remove state dependencies between tests.

Reason for this approach: an approach using a test DB schema (`SET search_path`) risks reaching DSQL's schema-count limit (10). A transaction rollback approach cannot be used because DDL does not work inside transactions in DSQL. Dropping tables plus a temporary directory is the simplest approach that does not conflict with DSQL constraints.
