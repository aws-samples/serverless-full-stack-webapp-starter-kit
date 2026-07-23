# ADR-001: Aurora DSQL + Drizzle ORM + custom migration runner

## Status

Accepted (v3.0.0)

## Context

The v2 architecture had three intertwined problems:

1. **VPC cost and Aurora Serverless v2 operational issues**: Aurora Serverless v2 requires a VPC + NAT for Lambda access. In addition to the operational cost of a VPC including a NAT Instance (t4g.nano, ~$3/month) and Bastion Host, it has operational overhead such as security groups, subnets, and waiting for Hyperplane ENI attach/detach when updating Lambda functions. Aurora Serverless v2 also did not fit the kit's use case: even with auto-pause (0 ACU) configured, a cold start after sleeping for 24 hours or more takes 20–30 seconds and degrades the user experience; scheduled jobs every five minutes keep it effectively always running, preventing it from benefiting from auto-pause; and retry and error handling for connection errors requires considerable development effort. It did not fit the kit's concept of "minimizing infrastructure costs while enabling rapid prototype development."
2. **Prisma binary overhead**: `prisma generate` generates platform-specific query-engine binaries. In a monorepo, every package that imports the Prisma Client requires generate. The binaries inflate Docker images and complicate cross-platform builds.
3. **Single `package.json` for unrelated components**: Next.js, asynchronous jobs, and the migration runner coexist in `webapp/`. Although `job.Dockerfile` was separate, the single `package.json` caused `npm ci` to install all webapp dependencies (React, Next.js, aws-amplify, etc.), inflating the image. Properly separating `dependencies`/`devDependencies` with esbuild tree-shaking could reduce the final image, but the temporary installation of all dependencies during builds and the cognitive load of this build method were problems. Extracting shared DB code into a monorepo package also required resolving Prisma's binary-sharing problem at the same time.

These three problems form a dependency chain: resolving the monorepo structure requires resolving Prisma sharing, the highest-impact improvement (eliminating VPC costs) requires changing the DB engine, and that in turn changes the ORM choice. Solving all three simultaneously avoids intermediate waste.

## Decision

**Database: Aurora DSQL** — A serverless distributed SQL database that does not require a VPC. Lambda connects with IAM authentication over the public internet. True pay-per-use billing (read/write RPUs) also results in zero cost when there is no traffic.

**ORM: Drizzle ORM** — A pure TypeScript ORM with no code generation step. Reasons for the choice:

1. Neither `prisma generate` nor platform-specific binaries are required. Schema definitions are ordinary TypeScript files and can be imported between packages in the monorepo without a build step.
2. `relations()` defines query-builder relations without generating SQL-level foreign keys, naturally fitting DSQL's no-FK constraint.
3. Prisma 7 is undergoing an architectural migration from Rust to TypeScript, and performance degradation for highly concurrent small queries has been reported. This avoids that risk.

Official Drizzle support for Aurora DSQL is not yet released (drizzle-team/drizzle-orm#5248), but it works through node-postgres.

**Migration runner: custom implementation** — The migration tools built into drizzle-kit are incompatible with DSQL:

- `drizzle-kit migrate`: Its internal implementation (dialect.ts) runs all unapplied migrations together in a single transaction. This fundamentally conflicts with DSQL's 1 DDL per transaction constraint. In addition, it uses `SERIAL PRIMARY KEY` to create its management table, which DSQL also does not support.
- `drizzle-kit push`: Runs DDL directly without accounting for DSQL constraints.

Following "Option 5" in the official Drizzle documentation (generate SQL with drizzle-kit and apply it with an external tool), adopt the same approach as Vercel's aws-dsql-movies-demo. For portability, the runner has a three-layer architecture (core logic / Lambda handler / CDK Construct). The CDK Construct automatically runs migrations with a deploy-time Trigger and guarantees change detection and re-execution through a content hash of `migrations/` (see C1 under "Consequences" below). See the [design doc](design.md#custom-migration-runner) for implementation specifications.

### Rejected alternatives

**Database:**

- _Aurora Serverless v2 (retain)_: VPC costs, cold starts, and the always-running issue caused by scheduled jobs remain. The development cost of retry handling for connection errors also remains unresolved.
- _DynamoDB_: Requires exhaustive advance coverage of access patterns for table design. Compared with the query flexibility provided by SQL in Aurora Serverless v2, it was determined to offer no advantage as a starter kit.

**ORM:**

- _Prisma + aurora-dsql-prisma-tools_: Requires `prisma generate`, leaving the binary overhead. `@relation` assumes FK support, requiring aurora-dsql-prisma-tools to remove FK statements from generated SQL. Prisma 7's Rust → TypeScript architectural migration creates further uncertainty.
- _Kysely_: A pure TypeScript query builder, but it lacks declarative relation definitions like Drizzle's `relations()`. Joins must be constructed manually.
- _Raw SQL_: Lacks type safety. This conflicts with the kit's goal of end-to-end type safety from the DB to React components.

**Migration runner:**

- _drizzle-kit migrate_: Runs all migrations in one transaction — fundamentally incompatible with DSQL's 1 DDL per transaction constraint.
- _drizzle-kit push_: Ignores DSQL constraints.
- _Flyway_: Has a JVM dependency. It adds operational complexity to a Node.js/TypeScript project. (It added DSQL dialect support in February 2026, but the JVM requirement remains.)

## Consequences

- **Impact of DDL constraints**: DSQL constraints affect schema design, lint rules, and migration tools. Major constraints: no FK, no SERIAL, 1 DDL per transaction, `CREATE INDEX ASYNC` required, and ALTER TABLE supports only ADD COLUMN, RENAME, IDENTITY operations, OWNER TO, and SET SCHEMA (DROP COLUMN, ALTER COLUMN TYPE, SET/DROP NOT NULL, SET/DROP DEFAULT, and DROP CONSTRAINT are not allowed. ADD COLUMN also cannot include DEFAULT/NOT NULL/CHECK/UNIQUE/PRIMARY KEY — add it as nullable and backfill with UPDATE). Note that `json`/`jsonb` were initially unsupported, but are now available because DSQL added support in 2026 (automatically compressed, but not indexable. See AGENTS.md / README for details). A two-layer detection strategy is required (oxlint for schema definitions and SQL validation for generated migrations; the latter also detects ADD COLUMN constraints and missing `ASYNC`). See the [design doc](design.md#ddl-constraints) for the complete list of DDL constraints.
- **Migration runner maintenance**: The custom runner is additional code to maintain. However, its core logic is approximately 200 lines and has comprehensive tests (unit + integration).
- **Drizzle DSQL support gap**: Drizzle does not yet officially support Aurora DSQL (drizzle-team/drizzle-orm#5248). drizzle-kit generate does not account for DSQL constraints — its output requires automatic transformation (`CREATE INDEX` → `CREATE INDEX ASYNC`, FK removal) and validation. A two-layer compatibility check is introduced to mitigate this risk.
- **Table recreation for schema changes**: Due to DSQL's limited ALTER TABLE support, many schema changes require table recreation with data migration. The runner supports `.sql` and `.mjs` migration files for batch data operations (`.ts` is unsupported — because the same file runs untransformed locally and in Lambda. See [ADR-005](adr-005-migration-file-format.md) for details).
- **Migration state management**: The `_migrations` table tracks only name (full file name) + executed_at. **Tamper detection using content hashes** for applied files was rejected. When a formatter or editor formats an applied file, its byte sequence changes and causes a hash mismatch error even if the logic has not changed. Git management sufficiently prevents tampering with applied files. This is a separate mechanism with a different purpose from the zip asset hash that drives deploy-time re-execution (C1 below).
- **Guarantee of migration re-execution at deploy time (C1)**: The CDK Construct packages the runner as a `NodejsFunction` zip asset and copies the entire `migrations/` directory into the asset root. Standard CDK asset hashing therefore captures migration changes; the changed asset produces a new `currentVersion` logical ID, which changes the CDK Trigger's version `HandlerArn` and re-executes the latest runner. This guarantees "migration change → new asset/version → Trigger re-executes the latest version" without `invalidateVersionBasedOn`, a separate directory hash, or a custom `MigrationHash` Trigger property. The copied directory remains a superset of the runner's target (`.sql`/`.mjs`), so migration metadata changes can only cause harmless extra re-execution.
- **Error recovery strategy**: Do not automatically roll back on `check-dsql-compat` errors. To avoid depending on drizzle-kit's internal format (snapshot JSON), the user explicitly reverts with `git checkout -- migrations/`.

### Differences from the Vercel demo (aws-dsql-movies-demo)

| Feature                      | Vercel demo                          | This migrator                                                                                             |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Management table             | `migrations` (id, name, executed_at) | `_migrations` (name, executed_at)                                                                         |
| Hash verification            | None                                 | Content-hash tamper detection is not adopted (the zip asset hash covers migration changes at deploy time) |
| drizzle-kit generate         | Not used (handwritten SQL)           | Used (output is automatically transformed)                                                                |
| Automatic SQL transformation | None                                 | statement-breakpoint → blank lines, INDEX → ASYNC, FK removal                                             |
| SQL validation               | None                                 | Detects ALTER COLUMN TYPE, DROP COLUMN, etc.                                                              |
| Execution environment        | CLI only                             | CLI + Lambda (CDK Trigger)                                                                                |
| Connection method            | Vercel OIDC                          | IAM authentication (Lambda execution role / AWS profile)                                                  |
| `already exists` skip        | Yes                                  | Yes                                                                                                       |
