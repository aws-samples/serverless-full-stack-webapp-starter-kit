# v3 Migration Prompt

## Purpose

You are an AI coding agent migrating a user's application from v2 to v3 of the Serverless Full Stack WebApp Starter Kit. This document is your migration plan — read it fully before starting, then execute each phase in order.

The user has a v2-based application (their own code built on top of the kit) and a running Aurora Serverless v2 database with production data. Your job is to migrate their codebase and data safely, with checkpoints at each phase to prevent data loss.

## Prerequisites

- Node.js >= v22, pnpm >= v10, Docker, AWS CLI with configured IAM profile
- The user's v2 application source code
- Access to the user's AWS account (Aurora Serverless v2 cluster, Cognito, etc.)
- A copy of the v3 kit for reference (schema patterns, configuration examples)

## Phase 0: Backup and pre-assessment

Before any code changes, secure the existing data and understand the current schema.

1. **Create Aurora Serverless v2 snapshot**:
   ```bash
   aws rds create-db-cluster-snapshot \
     --db-cluster-identifier <cluster-id> \
     --db-cluster-snapshot-identifier v2-pre-migration-$(date +%Y%m%d)
   ```

2. **Dump schema and data** (connect via Bastion Host or VPC-accessible environment):
   ```bash
   pg_dump --schema-only -h <aurora-endpoint> -U <user> -d <db> > schema-v2.sql
   pg_dump --data-only -h <aurora-endpoint> -U <user> -d <db> > data-v2.sql
   ```

3. **Assess the current schema**: Review the user's full schema — all tables, columns, data types, indexes, constraints. Do not assume it matches the kit's default schema. Identify:
   - Tables with SERIAL/BIGSERIAL primary keys → will need UUID or IDENTITY conversion
   - ENUM types → will become TEXT
   - JSON/JSONB columns → will become TEXT
   - Foreign key constraints → will be removed (use Drizzle `relations()` instead)
   - Indexes → will need `ASYNC` keyword
   - Row counts per table (tables > 3,000 rows need batched migration)

4. **Checkpoint**: Verify snapshot exists (`aws rds describe-db-cluster-snapshots`), verify dump files are non-empty, confirm you can restore from the snapshot.

## Phase A: Package manager migration (npm → pnpm)

1. Create `pnpm-workspace.yaml` at the project root
2. Delete `package-lock.json`
3. Create `.npmrc` with `shamefully-hoist=false` (strict mode)
4. Run `pnpm install`

**Checkpoint**: `pnpm install` exits with code 0.

## Phase B: Monorepo restructuring (apps/ + packages/)

Restructure the project into the v3 layout:

```
apps/
  cdk/             ← from cdk/
  webapp/          ← from webapp/ (remove src/jobs/)
  async-job/       ← extract from webapp/src/jobs/
packages/
  db/              ← new: Drizzle schema, client, migration runner
  shared-types/    ← new: job payload types
```

1. Move directories and update import paths
2. Update `pnpm-workspace.yaml` to include `apps/*` and `packages/*`
3. Update `tsconfig.json` references in each package

**Checkpoint**: `tsc --noEmit` exits with code 0 in each package.

## Phase C: ORM migration (Prisma → Drizzle)

### Schema conversion

Write the Drizzle schema by hand in `packages/db/src/schema.ts`, referencing the Phase 0 schema dump and following v3's patterns. Do NOT use `drizzle-kit introspect` against Aurora v2 — its output uses SERIAL, `.references()`, and other DSQL-incompatible patterns that require full rewriting.

DSQL-compatible schema rules:
- `SERIAL` / `BIGSERIAL` → `uuid('id').primaryKey().defaultRandom()` or IDENTITY column
- `ENUM` → `text('status')` (validate with Zod at the application layer)
- `JSON` / `JSONB` → `text('data')` (serialize/deserialize in application code)
- Foreign keys → do NOT use `.references()`. Define `relations()` separately for query builder joins
- `@updatedAt` → use `.$onUpdate(() => new Date())` or set explicitly in application code
- `numeric` type: Prisma returns `number`, Drizzle returns `string`. Update application code accordingly

### Query conversion patterns

| Prisma | Drizzle |
|--------|---------|
| `prisma.model.findMany()` | `db.query.model.findMany()` or `db.select().from(table)` |
| `prisma.model.findUnique({ where: { id } })` | `db.query.model.findFirst({ where: eq(table.id, id) })` |
| `prisma.model.create({ data })` | `db.insert(table).values(data)` |
| `prisma.model.createMany({ data })` | `db.insert(table).values([...data])` |
| `prisma.model.update({ where, data })` | `db.update(table).set(data).where(eq(table.id, id))` |
| `prisma.model.delete({ where })` | `db.delete(table).where(eq(table.id, id))` |
| `prisma.$transaction([...])` | `db.transaction(async (tx) => { ... })` |

### Cleanup

1. Remove `@prisma/client`, `prisma`, and any Prisma-related packages from all `package.json` files
2. Delete `prisma/` directory (schema.prisma, migrations/)
3. Remove any `prisma generate` scripts from `package.json`
4. If `zod-prisma-types` was used, replace generated Zod schemas with hand-written ones or `drizzle-zod`

**Checkpoint**: `pnpm run build` exits with code 0. No Prisma imports remain (`rg '@prisma|from.*prisma' --type ts` returns no results).

## Phase D: Database migration (Aurora Serverless v2 → DSQL)

This phase requires 3 separate CDK deployments to prevent data loss. Do NOT attempt a single deployment — it would delete the Aurora v2 cluster and all data.

### Phase D-1: Create DSQL cluster (CDK deploy 1)

1. **Set RemovalPolicy.RETAIN on Aurora v2 resources**: Before any CDK changes, add `removalPolicy: cdk.RemovalPolicy.RETAIN` to the Aurora Serverless v2 cluster, VPC, and related resources. This prevents CloudFormation from deleting them when the stack is updated.

2. **Add DSQL cluster to CDK**: Add a `CfnCluster` resource for DSQL. Keep the webapp and async-job still pointing to Aurora v2.

3. **Deploy**:
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

**Checkpoint**: DSQL cluster is ACTIVE (`aws dsql get-cluster --identifier <id>`). Aurora v2 cluster still exists with data intact.

### Phase D-2: Data migration

1. **Create DSQL schema**: Run the migration runner against the new DSQL cluster to create tables:
   ```bash
   pnpm --filter @repo/db run migrate
   ```

2. **Migrate data from Aurora v2 to DSQL**:

   For small datasets (< 3,000 rows per table):
   - Use the Phase 0 `pg_dump --data-only` output
   - Transform data for DSQL compatibility (SERIAL PKs → UUID values, ENUM → TEXT values)
   - Insert into DSQL via a migration script

   For large datasets (> 3,000 rows per table):
   - Batch INSERT in 500–1,000 row chunks (DSQL's 3,000 row/transaction limit)
   - Consider DMS + S3 for very large tables (see [sample-migration-aurora-dsql-using-ai](https://github.com/aws-samples/sample-migration-aurora-dsql-using-ai))
   - Use a `.ts` migration file with `export default async function(client: PoolClient)` for complex transformations

   For guidance on AI-assisted DSQL migration patterns, see [Agentic migration with AI tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html).

3. **Verify data integrity**: For each table, compare row counts between Aurora v2 and DSQL:
   ```sql
   -- On Aurora v2
   SELECT count(*) FROM "TableName";
   -- On DSQL
   SELECT count(*) FROM "TableName";
   ```

**Checkpoint**: Row counts match for every table between Aurora v2 and DSQL.

### Phase D-3: Application switchover (CDK deploy 2)

1. **Update CDK**: Remove Aurora v2 resource definitions (they have RETAIN, so the actual resources stay). Point webapp and async-job environment variables to the DSQL endpoint. Remove VPC configuration from Lambda functions.

2. **Deploy** (recommend a maintenance window for production):
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

3. **Known issue — VPC ENI cleanup**: When Lambda functions are removed from a VPC, AWS does not immediately delete the Hyperplane ENIs. These remain in `available` state for up to 20 minutes, blocking security group and subnet deletion. CloudFormation may report `DELETE_FAILED`.

   Workaround:
   ```bash
   # Find orphaned ENIs
   aws ec2 describe-network-interfaces \
     --filters "Name=description,Values=AWS Lambda VPC ENI*" "Name=status,Values=available" \
     --region <region>
   # Delete each ENI
   aws ec2 delete-network-interface --network-interface-id <eni-id> --region <region>
   # Delete security groups if CloudFormation marked them DELETE_FAILED
   aws ec2 delete-security-group --group-id <sg-id> --region <region>
   ```

**Checkpoint**: Application works end-to-end via DSQL — sign in, CRUD operations, async jobs with real-time notifications.

### Phase D-4: Delete old resources (CDK deploy 3 — or manual)

⚠️ **Point of no return. Ask the user for explicit confirmation before proceeding.**

1. Delete the retained Aurora v2 cluster, VPC, NAT Instance, Bastion Host
2. This can be done via CDK (remove RETAIN resources and deploy) or manually via AWS Console/CLI

**Checkpoint**: Old resources are deleted. No VPC costs remain.

## Phase E: Linter migration (ESLint → oxlint)

1. Remove `eslint`, `prettier`, `eslint-config-next`, and related packages from all `package.json` files
2. Add `oxlint` to root `devDependencies`
3. Create `oxlintrc.json` with DSQL-specific rules:
   - `no-restricted-imports`: block `serial`, `smallserial`, `bigserial`, `json`, `jsonb` from `drizzle-orm/pg-core`
4. Update `package.json` lint scripts: `eslint` → `oxlint`
5. Add `oxfmt` for formatting (replaces Prettier)

**Checkpoint**: `pnpm run lint` exits with code 0. No ESLint/Prettier imports remain.

## Safeguards

- **Do not proceed to the next phase if the current phase's checkpoint fails.** Fix the issue first.
- **Phase D-4 requires explicit user approval.** Present the list of resources to be deleted and wait for confirmation.
- **Before Phase D-2, re-verify that the Aurora v2 snapshot from Phase 0 exists.** If it doesn't, create a new one before proceeding.
- **Rollback safety**: At any point before Phase D-4, the user can revert to Aurora v2 by restoring the snapshot and redeploying v2 CDK code. After Phase D-4, rollback requires restoring from snapshot and recreating VPC resources.
- **Each phase is independently safe**: Phase A–C are code-only changes (no data risk). Phase D-1 adds resources without removing any. Phase D-2 copies data (source untouched). Phase D-3 switches traffic but old resources remain. Only Phase D-4 is destructive.

## Breaking changes reference

### Package manager

- `npm ci` → `pnpm install`
- `npm run <script>` → `pnpm run <script>`
- `package-lock.json` → `pnpm-lock.yaml`

### Project structure

```
webapp/          → apps/webapp/
cdk/             → apps/cdk/
                   apps/async-job/     (new, extracted from webapp/src/jobs/)
                   packages/db/        (new, Drizzle schema + migration runner)
                   packages/shared-types/ (new, job payload types)
```

### ORM (Prisma → Drizzle)

- No `prisma generate` step — Drizzle is pure TypeScript
- Schema in `packages/db/src/schema.ts` using `pgTable()` API
- Relations use `relations()` (query builder only, no SQL-level FK)
- Zod schemas are hand-written, not generated from ORM
- `numeric` type: Prisma returns `number`, Drizzle returns `string`

### Database (Aurora Serverless v2 → DSQL)

- No VPC, NAT Instance, or Bastion Host
- IAM authentication instead of username/password
- DSQL constraints: no SERIAL (use UUID/IDENTITY), no FK, no JSON/JSONB (use TEXT), 1 DDL per transaction, `CREATE INDEX ASYNC` only
- Limited ALTER TABLE: only ADD COLUMN, RENAME, identity operations, OWNER TO, SET SCHEMA
- 3,000 rows per write transaction
- No TRUNCATE (use `DELETE FROM`)

### Linting (ESLint → oxlint)

- `eslint` → `oxlint`
- `prettier` → `oxfmt`
- DSQL-specific `no-restricted-imports` rules in `oxlintrc.json`

### Docker builds in pnpm monorepo

- `pnpm install --filter` does not hoist transitive dependencies in strict mode. Use `pnpm install --frozen-lockfile` without `--filter` in Dockerfiles.
- CDK `DockerImageCode.fromImageAsset` requires `ignoreMode: IgnoreMode.DOCKER` to read `.dockerignore`.
- esbuild `--format=esm` output needs `.mjs` extension for Lambda.
- `--external:@aws-sdk/*` does not exclude `@aws/*` packages (e.g., `@aws/aurora-dsql-node-postgres-connector`). Bundle them explicitly.
