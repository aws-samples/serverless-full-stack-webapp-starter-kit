# v3 Migration Prompt

## Purpose

This document is a starting-point template for planning a migration from v2 to v3. Because each downstream project has user-specific schemas, custom extensions, and data volumes, do not execute this document as-is. Instead, create a project-specific migration plan based on the results of the Phase 1 pre-assessment.

Planning flow:

1. Read this entire document to understand the phase structure and rules of conduct
2. Execute Phase 1 (backup and pre-assessment) to analyze the user's schema, data, and custom extensions
3. Based on the analysis results, document the concrete tasks and checkpoints for each phase as a project-specific plan
4. Execute each phase in order according to the plan

## Prerequisites

- Node.js >= v22 (v3 Lambda runtime / Docker builds use Node 24; Node 24 is also recommended locally), pnpm >= v10.26 (v3 root `package.json` is pinned to `packageManager: pnpm@10.34.4`), and AWS CLI with an IAM profile configured
- Docker is required only for local verification. Image builds for actual deployments run in AWS **CodeBuild** (through the `ContainerImageBuild` construct in `@cdklabs/deploy-time-build` — see [ADR-006](adr-006-deploy-time-image-build.md) for details). Deployment is possible on Windows or in environments without Docker
- **The CloudFormation execution role for CDK bootstrap must have permission to create CodeBuild projects, ECR repositories, and Custom Resource Lambdas.** The default bootstrap with `AdministratorAccess` requires no additional configuration. Downstream apps that use a hardened bootstrap must explicitly grant permissions to create these resources
- The user's v2 application source code
- Access to the user's AWS account (Aurora Serverless v2 cluster, Cognito, and so on)
- **A copy of the v3 kit for reference** — Read the v3 kit to understand its directory structure, configuration files, and schema patterns. This document does not describe information that can be read from the v3 kit's code

## Rules of conduct

⚠️ **Most important rule: Do NOT skip phases.** In particular, Phase 5 (database migration) requires a phased CDK deploy. If you remove the Aurora v2 resource definitions without setting RETAIN, CloudFormation deletes the cluster and production data is lost. Always proceed step by step in this order: Phase 5-1 (RETAIN + add DSQL) → 5-2 (data migration) → 5-3 (cutover) → 5-4 (remove old resources).

1. **If the current phase's checkpoint fails, do not proceed to the next phase.** Fix the problem first
2. **Phase 5-4 requires the user's explicit approval.** Present the list of resources to be deleted and wait for confirmation
3. **Before Phase 5-2, reconfirm that the Aurora v2 snapshot from Phase 1 exists.** If it does not, create a new snapshot before proceeding
4. **Rollback safety**: Before Phase 5-4, you can return to Aurora v2 at any time by restoring from the snapshot and redeploying the v2 CDK code. Rollback after Phase 5-4 requires restoration from the snapshot and recreation of VPC resources
5. **Data risk by phase**: Phases 1–4 change code only (no data risk). Phase 5-1 only adds resources. Phase 5-2 copies data (the source remains unchanged). Phase 5-3 switches traffic, but old resources remain. **Only Phase 5-4 is destructive**

## Files that can be copied directly from the v3 kit

The following files are foundation code that does not contain sample-specific customization in the v3 kit, and are candidates for direct copying from the v3 kit. Copy without transformation or hand-editing only files whose same-named counterpart in the v2 downstream app was confirmed unchanged by the user during the inventory in section 1-4 (see [1-4. Inventory user custom extensions](#1-4-inventory-user-custom-extensions)).

If the downstream app contains modifications, merge only the v3 changes; do not overwrite it by copying the entire file. In particular, the following files are entry points that integrate multiple Constructs, props, and environment variables. **Always use a 3-way merge when copying them**, because they are likely to contain custom Constructs or custom props:

- `apps/cdk/lib/main-stack.ts` — Central location for custom Construct instantiation and dependency injection
- `apps/cdk/lib/us-east-1-stack.ts` — May contain custom Lambda@Edge functions or ACM certificates
- `apps/cdk/bin/cdk.ts` — User configuration such as stack names, tags, and domain names
- `apps/webapp/src/proxy.ts` — Location for authorization logic customization
- `apps/webapp/next.config.ts` — Merge while preserving the user's existing configuration

| Source (v3 kit)                                   | Notes                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                             | `packages: [apps/*, packages/*]` and `minimumReleaseAge: 4320` (supply-chain protection that excludes npm packages published within the last 72 hours from dependency resolution)                                                                                                                                                        |
| `package.json` (root)                             | Includes `packageManager: pnpm@10.34.4`, `engines.pnpm: >=10.26`, `prepare: simple-git-hooks`, and configuration for `simple-git-hooks` / `lint-staged`. Do not retain the user's root scripts (each workspace owns its own scripts)                                                                                                     |
| `oxlintrc.json`                                   | Blocks DSQL-incompatible imports (`serial`/`smallserial`/`bigserial`) through linting. Enables plugins including `typescript`, `unicorn`, `react`, and `import/no-cycle`                                                                                                                                                                 |
| `.oxfmtrc.json`                                   | —                                                                                                                                                                                                                                                                                                                                        |
| `.dockerignore`                                   | For the monorepo root. Excludes `**/node_modules`, `**/.next`, `apps/cdk/cdk.out`, `.starter-kit`, `*.md`, and so on                                                                                                                                                                                                                     |
| `packages/db/src/client.ts`                       | Proxy lazy initialization + `globalThis` singleton                                                                                                                                                                                                                                                                                       |
| `packages/db/src/migrate.ts`                      | Migration runner core logic. `.mjs` uses the `(client, context)` signature (`context: MigrationContext` includes `region`)                                                                                                                                                                                                               |
| `packages/db/src/migration-files.ts`              | Single source of truth for the formats processed by `migrate.ts` (`.sql` / `.mjs`, extension list + predicate function). **The CDK Construct intentionally hashes the entire `migrations/` directory to prevent missed formats, so do not import this module** — but `migrate.ts` imports it, so an omitted copy prevents startup        |
| `packages/db/src/dsql-compat.ts`                  | SQL transformation + validation                                                                                                                                                                                                                                                                                                          |
| `packages/db/src/migrate-cli.ts`                  | Migration CLI entry point (injects `process.env.AWS_REGION` into `MigrationContext`)                                                                                                                                                                                                                                                     |
| `packages/db/src/check-dsql-compat.ts`            | drizzle-kit generate post-processing                                                                                                                                                                                                                                                                                                     |
| `packages/db/src/cluster-cli.ts`                  | Create and delete development DSQL clusters                                                                                                                                                                                                                                                                                              |
| `packages/db/drizzle.config.ts`                   | References the schema only. Does not have `dbCredentials` (`generate` does not need a DB connection)                                                                                                                                                                                                                                     |
| `packages/db/package.json`                        | `exports` includes `./schema`, `./client`, `./migrate`, and `./migration-files`                                                                                                                                                                                                                                                          |
| `packages/db/tsconfig.json`                       | —                                                                                                                                                                                                                                                                                                                                        |
| `packages/shared-types/package.json`              | —                                                                                                                                                                                                                                                                                                                                        |
| `packages/shared-types/tsconfig.json`             | —                                                                                                                                                                                                                                                                                                                                        |
| `packages/event-utils/`                           | **New workspace in v3** (shares the SigV4 implementation of `sendEvent` between webapp / async-job). Import as `@repo/event-utils/send-event`                                                                                                                                                                                            |
| `apps/db-migrator/`                               | **New workspace in v3** (separated from the former `apps/cdk/lib/constructs/dsql-migrator/handler.ts` in `4149c22`). Includes `package.json`, `tsconfig.json`, and `src/handler.ts`                                                                                                                                                      |
| `apps/webapp/src/app/api/health/route.ts`         | LWA readiness route (always returns 200 for GET, with no dependencies). **Required as a pair with `AWS_LWA_READINESS_CHECK_PATH="/api/health"` in the `Dockerfile`**. If you set `AWS_LWA_READINESS_CHECK_PATH` without this route, the readiness probe runs against authentication-required `/` and fails with 401/302 (Issue #188 fix) |
| `apps/webapp/src/lib/api/with-auth.ts`            | Auth guardrail for API Route Handlers (resolves with `tryGetAuthSession`, returns JSON 401 when unauthenticated, JSON-encodes the handler return value)                                                                                                                                                                                  |
| `apps/webapp/src/proxy.ts`                        | Optimistic authorization check (checks only for the presence of the Amplify `LastAuthUser` cookie). This is **not** Next.js `middleware.ts` (it runs inside the Lambda handler)                                                                                                                                                          |
| `apps/webapp/vitest.config.ts`                    | vitest configuration for the webapp (added in `e62704a`; runs `auth.test.ts` / `proxy.test.ts`)                                                                                                                                                                                                                                          |
| `apps/cdk/lib/constructs/database.ts`             | DSQL CfnCluster + IAM authentication. The default `removalPolicy` is `RETAIN_ON_UPDATE_OR_DELETE`                                                                                                                                                                                                                                        |
| `apps/cdk/lib/constructs/dsql-migrator/index.ts`  | Zip-packaged `NodejsFunction` + `Trigger`; esbuild copies `migrations/` into the asset, so normal asset hashing drives version and Trigger updates. The handler lives in `apps/db-migrator/`.                                                                                                                                            |
| `apps/cdk/lib/constructs/cf-lambda-furl-service/` | Full CloudFront + Lambda Function URL implementation. Includes `webAclId?` / `geoRestriction?` props. The default behavior uses managed `CACHING_DISABLED`, and `/_next/static/*` uses `CACHING_OPTIMIZED` ([ADR-007](adr-007-cloudfront-flat-rate.md))                                                                                  |
| `apps/cdk/lib/us-east-1-stack.ts`                 | Resources in us-east-1: Lambda@Edge (sign-payload), ACM certificate, and **WAF Web ACL** (scope=CLOUDFRONT; only `AWSManagedRulesKnownBadInputsRuleSet`. Required for enrollment in the CloudFront flat-rate plan)                                                                                                                       |
| `apps/cdk/lib/main-stack.ts`                      | Entry stack. Receives `webAclId?` through a cross-region reference and passes it to the `Webapp` construct                                                                                                                                                                                                                               |

The following require user-specific conversion, so hand-write or transform them rather than copying:

| File                                       | Reason                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                | Includes tables and columns added by the user                                                                                                                                                                                                                                       |
| `packages/db/migrations/`                  | Initial migration SQL corresponding to the user's schema. Do not copy the v3 kit's `0001_initial.sql`, because it is for the sample schema                                                                                                                                          |
| `packages/shared-types/src/job-payload.ts` | Includes job types added by the user                                                                                                                                                                                                                                                |
| `apps/async-job/`                          | Includes job handlers added by the user (`package.json`, `tsconfig.json`, `Dockerfile`, `src/handler.ts`, `src/jobs/`). The v3 kit's Dockerfile and package.json include sample dependencies (such as `@aws-sdk/client-translate`), so replace them with user-specific dependencies |
| `apps/webapp/Dockerfile`                   | Base it on the v3 kit and reflect dependencies and build args added by the user                                                                                                                                                                                                     |
| `apps/webapp/src/lib/auth.ts`              | Split into three functions: `getAuthSession` / `tryGetAuthSession` / `getSessionWithUser`. It references the `users` table in `packages/db/schema`, so it must be aligned with the user's schema.ts                                                                                 |
| `apps/webapp/next.config.ts`               | v3 requires adding `transpilePackages: ['@repo/db', '@repo/shared-types', '@repo/event-utils']`. Merge while preserving the user's existing configuration                                                                                                                           |
| `apps/cdk/bin/cdk.ts`                      | User configuration such as stack names, tags, and domain names. In v3, includes the entry point that passes `webAclId: virginia.webAclArn` to `MainStack`                                                                                                                           |

## Phase 1: Backup and pre-assessment

Before changing code, secure existing data and understand the current schema.

### 1-1. Create an Aurora Serverless v2 snapshot

```bash
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier <cluster-id> \
  --db-cluster-snapshot-identifier v2-pre-migration-$(date +%Y%m%d)
```

### 1-2. Dump schema and data

Connect from a Bastion Host or an environment with VPC access:

```bash
pg_dump --schema-only -h <aurora-endpoint> -U <user> -d <db> > schema-v2.sql
pg_dump --data-only -h <aurora-endpoint> -U <user> -d <db> > data-v2.sql
```

### 1-3. Analyze the user schema

Read both the user's `prisma/schema.prisma` and `schema-v2.sql`, and identify the following DSQL-incompatible patterns. Do not assume that they match the kit's default schema — the user has added custom tables and columns.

Use schema.prisma as the primary data source. Reason: The Prisma schema provides structured model definitions, making the correspondence of field types, relationships, and default values clear. Dump SQL contains raw PostgreSQL DDL, making it difficult to isolate DSQL-incompatible patterns. Use schema-v2.sql as a supplement for checking indexes and constraints added at runtime.

| Detect                                           | DSQL handling                                      | Decision criteria                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERIAL` / `BIGSERIAL` primary key               | `uuid().defaultRandom()` or IDENTITY column        | If existing data has external references, conversion to UUID also requires updating the referring sources                                                                                                                                                                                                                                   |
| Primary key with `@default(uuid())`              | Choose `uuid()` or `text()`                        | **DSQL does not support implicit type casts between `uuid` and `text`.** If application code or queries compare with string literals, use `text()`. If choosing `uuid()`, all comparisons must use matching types                                                                                                                           |
| `ENUM` type                                      | `text()` + Zod validation                          | Inventory the existing ENUM values and enumerate them in a Zod schema                                                                                                                                                                                                                                                                       |
| `JSON` / `JSONB` column                          | `jsonb()` (recommended) or `text()`                | **DSQL supports `json`/`jsonb`** (compressed and **not indexable**). Prisma `Json` can migrate directly to `jsonb()`; parse/stringify is unnecessary. Extract fields used as search or sort keys into separate columns (`jsonb` cannot be indexed). If choosing TEXT + manual serialization, add `JSON.parse`/`JSON.stringify` in Phase 3-4 |
| Foreign-key constraint (`@relation`)             | Remove (replace with Drizzle `relations()`)        | **Identify deletion logic that depends on `onDelete: Cascade` / `onDelete: SetNull`.** DSQL does not support FKs, so convert cascade deletion to explicit deletion within `db.transaction()` at the application layer                                                                                                                       |
| `String[]` type                                  | `text()` + JSON serialization                      | **`pg_dump` outputs PostgreSQL array literals in `{}` form.** During data migration in Phase 5-2, convert them to JSON arrays in `[]` form (`JSON.parse('{}')` returns an object)                                                                                                                                                           |
| Index (`@@index`)                                | Convert to `CREATE INDEX ASYNC`                    | —                                                                                                                                                                                                                                                                                                                                           |
| `Decimal` / `Float` type                         | Drizzle returns `string` (Prisma returns `number`) | Identify application code locations that perform numeric calculations                                                                                                                                                                                                                                                                       |
| `@updatedAt`                                     | `.$onUpdate(() => new Date())`                     | —                                                                                                                                                                                                                                                                                                                                           |
| Generated Zod schemas such as `zod-prisma-types` | Replace by hand-writing or with `drizzle-zod`      | Identify the generated files                                                                                                                                                                                                                                                                                                                |

Also record the row count for every table — tables with more than 3,000 rows require batch migration in Phase 5-2.

### 1-4. Inventory user custom extensions

Identify files added or modified from the v2 kit default. This is required to determine their correct destination in subsequent phases.

- **Custom CDK Constructs**: VPC-dependent ones (such as Lambdas connected to RDS) must have their VPC dependency removed in Phase 5
- **Custom async jobs**: List files under `webapp/src/jobs/`
- **CI/CD pipelines**: Check `.github/workflows/` and similar locations for v2-specific commands such as `npm ci` and `npx prisma generate`
- **webapp configuration files**: Identify user modifications in `next.config.ts`, `tailwind.config.ts`, and so on

### Checkpoint

- Confirm the snapshot exists (`aws rds describe-db-cluster-snapshots`)
- Confirm that dump files are non-empty
- Complete analysis results recording incompatible patterns and row counts for every table
- Complete the inventory of user custom extensions

## Phase 2: Package-manager migration + monorepo structuring + linter introduction

Perform the pnpm migration, directory restructuring, and linter introduction in one phase. Reason: `pnpm-workspace.yaml` refers to `apps/*` and `packages/*`, so `pnpm install` fails unless the directory structure exists first. Introducing the linter at the same time immediately detects `serial`/`json`/`jsonb` imports while creating the Drizzle schema in Phase 3.

### 2-1. Restructure directories

Refer to the v3 kit's directory structure and restructure the user's project. Main changes:

- `webapp/` → `apps/webapp/` (remove `src/jobs/`)
- `cdk/` → `apps/cdk/`
- Extract `webapp/src/jobs/` into `apps/async-job/`
- Create `packages/db/`
- Create `packages/shared-types/`
- Create `packages/event-utils/` (SigV4 implementation of `sendEvent`; used by both webapp and async-job)
- Create `apps/db-migrator/` (workspace for the DSQL migration Lambda handler)

Determine destinations for custom code added by the user:

- Shared logic that includes DB access → consider extracting under `packages/`
- webapp-specific logic → leave in `apps/webapp/`
- Async jobs → move to `apps/async-job/src/jobs/` and add payload types to `packages/shared-types/`

### 2-2. Package-manager migration (npm → pnpm)

1. Copy the files listed in the “Files that can be copied directly from the v3 kit” section
2. Delete `package-lock.json`
3. Create each package's `package.json` by referring to the v3 kit. Update import paths
4. Run `pnpm install`

pnpm uses strict mode by default (`shamefully-hoist=false`). Do not create `.npmrc` — setting `shamefully-hoist=true` conceals undeclared dependencies in Docker builds.

### 2-3. Linter migration + pre-commit hook introduction (ESLint → oxlint)

1. Remove `eslint`, `prettier`, `eslint-config-next`, and related packages from all `package.json` files
2. Confirm the `oxlintrc.json` copied from the v3 kit (it contains rules that block DSQL-incompatible imports)
3. Update the root `package.json` to match the v3 kit:
   - Remove root-level script aliases (`dev`, `build`, `lint`, `test`, and so on). They are unnecessary because each subpackage owns its own scripts
   - Add `simple-git-hooks` and `lint-staged` to `devDependencies`
   - Add the `"prepare": "simple-git-hooks"` script (automatically installs hooks during `pnpm install`)
   - Add the `simple-git-hooks` and `lint-staged` configuration (refer to the v3 kit root `package.json`)
4. Run `pnpm install` to install hooks

### 2-4. Remove remaining npm/npx usage

Remove all remaining `npm` / `npx` commands from the project. The target includes not only `.ts` and `.json`, but also Dockerfiles, CI/CD workflows (`.yml`), and shell scripts:

```bash
rg 'npm |npx ' -g '!node_modules' -g '!pnpm-lock.yaml'
```

Main conversions:

- `npm ci` → `pnpm install --frozen-lockfile`
- `npm run <script>` → `pnpm run <script>`
- `npx <cmd>` → `pnpm exec <cmd>`
- `npm ci` in Dockerfiles → `npm install -g pnpm@10.34.4 && pnpm install --frozen-lockfile`

v3 Lambda Dockerfiles install pnpm with **`npm install -g` rather than the Corepack path** on the Node 24 base image (`ffc5ae7`). You may replace it at your own risk if you want to use Corepack, but the v3 kit's CI and Dockerfiles are written with this assumption.

**Replace `scripts/dsql.sh` calls** (`c2764c8`): v2 handled development DSQL clusters with `scripts/dsql.sh` (based on jq + AWS CLI), but v3 replaces it with the TypeScript CLI (the `cluster` script in `@repo/db`):

```bash
rg 'scripts/dsql\.sh' -g '!node_modules'
```

Replace detected calls according to their purpose:

- `scripts/dsql.sh create` → `pnpm --filter @repo/db run cluster create [--region <region>]`
- `scripts/dsql.sh delete` → `pnpm --filter @repo/db run cluster delete [--region <region>]`
- `scripts/dsql.sh status` → `pnpm --filter @repo/db run cluster status [--region <region>]`

Replacement targets include `.md` / `.yml` / `Makefile` / shell scripts. If they remain in a downstream app's README or CI, they cause command-not-found after the v3 migration.

### Checkpoint

- `pnpm install` completes with exit code 0
- `pnpm -r run lint` exits with code 0 (`oxlint`'s `typeCheck: true` also performs type checking, so `tsc --noEmit` is unnecessary)
- No ESLint/Prettier imports remain
- Confirm there is no remaining npm/npx usage with `rg 'npm |npx ' -g '!node_modules' -g '!pnpm-lock.yaml'`
- `rg 'scripts/dsql\.sh' -g '!node_modules'` returns no results (no references to the old script remain)

## Phase 3: ORM migration (Prisma → Drizzle)

### 3-1. Analyze the user's Prisma schema

Based on the Phase 1-3 analysis results, create a conversion plan for each model in `prisma/schema.prisma`:

1. List every model and determine the DSQL-compatible Drizzle type for each field
2. Create a mapping table that converts relationships defined with `@relation` to Drizzle `relations()`
3. Determine the replacement approach for generated Zod schemas identified in Phase 1-3

### 3-2. Create the Drizzle schema

Hand-write the Drizzle schema in `packages/db/src/schema.ts` according to the conversion plan from Phase 3-1. Use the v3 kit's `schema.ts` as a pattern reference.

**Do not use `drizzle-kit introspect` against Aurora v2** — its output includes `SERIAL`, `.references()`, and other DSQL-incompatible patterns, requiring a complete rewrite. Hand-writing from schema.prisma is more reliable.

### 3-3. Generate initial migration SQL

The v3 kit's `packages/db/migrations/` contains `0001_initial.sql` and `meta/` for the sample schema. Delete them before generating initial migration SQL for the user's schema:

```bash
rm -rf packages/db/migrations/*
```

Then generate:

```bash
pnpm --filter @repo/db run generate
```

`check-dsql-compat.ts` performs automatic transformation and validation. If it reports an error, follow the procedure in the “Database migration” section of AGENTS.md.

After generation, check snapshot-chain integrity (`I15` / `drizzle-kit check`; detects branches with the same `prevId` and divergence from `schema.ts`):

```bash
pnpm --filter @repo/db run check:migrations
```

`Everything's fine` is the expected output. If an error occurs, do not proceed to Phase 5; follow the repair procedure in `packages/db/README.md` to restore a linear chain.

### 3-4. Convert application code

Identify all files in the user's codebase that import Prisma (`rg '@prisma|from.*prisma' --type ts`) and convert them to the Drizzle API. Use the v3 kit's Server Action implementations as reference patterns.

Main conversion points:

- `import { prisma } from '@/lib/prisma'` → `import { db } from '@repo/db/client'`
- `import { ... } from '@prisma/client'` → `import { ... } from '@repo/db/schema'`
- Delete the v2 `prisma.ts` (PrismaClient with retry extensions). DSQL connects with IAM authentication and does not have Aurora v2's cold-start or idle-timeout problems, so the Prisma-style application-level retry extension is not ported. (The migration runner itself still implements DSQL wake-up retry with exponential backoff.)
- Add `transpilePackages: ['@repo/db', '@repo/shared-types', '@repo/event-utils']` to `next.config.ts` (merge while preserving the user's existing configuration). `@repo/event-utils` is the workspace package extracted from `apps/webapp/src/lib/events.ts` in v3 (`e9f4a4c`)
- **Change the `sendEvent` import path**: v2 called it from `apps/webapp/src/lib/events.ts` / `apps/async-job/src/events.ts`, but v3 consolidates it in `@repo/event-utils/send-event`. Bulk-update import paths wherever the downstream app calls `sendEvent`
- **Inventory all uses of Json columns** (use `rg 'Json|\.json\b' --type ts` to identify schema definitions and read/write locations). Prisma automatically parses/stringifies Json types, but Drizzle `text()` requires manual conversion. Add `JSON.parse()` when reading and `JSON.stringify()` when writing
- **Convert Prisma nested creates (implicit transactions) to `db.transaction()`.** In particular, rewrite deletion logic that depended on `onDelete: Cascade` to delete child tables first and then the parent table within `db.transaction()`
- **Do not combine `db.query.*.findMany()` with `exists()`/`notExists()` subqueries.** `findMany()` internally aliases the table, but column references in `where`/`extras` expand to the original table name, causing `invalid reference to FROM-clause entry for table`. Rewrite it as `db.select().from().leftJoin()`. `findFirst()` is safe when there are no subqueries. See drizzle-team/drizzle-orm#3068 for details

### 3-5. Apply authentication patterns

v3 authentication uses the same Cognito + Amplify server-side auth framework as v2, but **session retrieval functions are split into three** (`e62704a`). Use the following three functions in `apps/webapp/src/lib/auth.ts` according to the nature of the call site:

| Function               | Use case                                                                | Behavior when unauthenticated                         | DB access    |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ------------ |
| `getAuthSession()`     | Authentication-required locations in Server Components / Server Actions | Throws `UnauthenticatedError`                         | None         |
| `tryGetAuthSession()`  | API Route Handlers (when you want to return 401)                        | Returns `null` (rethrows other errors)                | None         |
| `getSessionWithUser()` | Server Components that also require the DB `users` record               | Throws `UnauthenticatedError` / `UserNotCreatedError` | One `SELECT` |

`getAuthSession` / `getSessionWithUser` are memoized in request scope with React `cache()`.

**Use `withAuth()` for API Route Handler authentication** (`458414a`). If a downstream app has routes under `app/api/**/route.ts` that require authentication:

```ts
// Recommended pattern in v3
import { withAuth } from '@/lib/api/with-auth';

export const GET = () =>
  withAuth(async (session) => {
    // session is { userId, email, accessToken }
    return { data: '...' }; // JSON-encoded and returned with 200
  });
```

`withAuth` calls `tryGetAuthSession`; when unauthenticated it returns `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`, and when authenticated it wraps and returns the handler result with `NextResponse.json()`. For handlers that return a **custom response format** (returning only a bearer token, non-JSON, streaming, and so on), do not use `withAuth`; call `tryGetAuthSession` directly and construct the response yourself.

**Public routes do not use `withAuth`**: `apps/webapp/src/app/api/health/route.ts` (LWA readiness) and `apps/webapp/src/app/api/auth/[slug]/route.ts` (Cognito authentication callback) intentionally bypass authentication. The same applies to equivalent public endpoints in downstream apps.

### 3-6. Cleanup

1. Remove Prisma-related packages such as `@prisma/client`, `prisma`, and `zod-prisma-types` from all `package.json` files
2. Delete the `prisma/` directory (schema.prisma and migrations/)
3. Remove the `prisma generate` script from `package.json`

### 3-7. Verify with a development DSQL cluster

Before touching the production database, verify schema and application-code behavior on a development DSQL cluster. Use the cluster command in the v3 kit's `packages/db`:

```bash
pnpm --filter @repo/db run cluster create --region <region>
```

This script creates a development DSQL cluster and automatically writes connection details to `packages/db/.env`.

Verification steps:

1. Run migrations and confirm that the schema succeeds on DSQL:
   ```bash
   pnpm --filter @repo/db run migrate
   ```
2. Start the webapp dev server and confirm CRUD operations work:
   ```bash
   cd apps/webapp && pnpm run dev
   ```
3. If there are problems, fix the schema or application code and verify again

After verification, leave the development cluster in place (delete it after the Phase 5 production migration completes):

```bash
# Run after Phase 5 completes
pnpm --filter @repo/db run cluster delete --region <region>
```

### Checkpoint

- `pnpm -r run lint` exits with code 0 (confirm that oxlint detects no DSQL-incompatible patterns)
- `pnpm -r run build` exits with code 0
- `pnpm --filter @repo/db run check:migrations` exits with code 0 (snapshot chain is linear; schema.ts and snapshot are synchronized)
- No Prisma imports remain (`rg '@prisma|from.*prisma' --type ts` returns no results)
- Migrations succeed on a development DSQL cluster and the application works

## Phase 4: CDK migration

Refer to the v3 kit's CDK code and update the user's CDK code. Complete non-DSQL CDK changes here before the Phase 5 database migration.

### 4-1. Update Dockerfiles

Update the webapp and async-job Dockerfiles to the v3 pattern. Base them on the v3 kit's Dockerfiles and reflect user-added custom dependencies and build args. Main changes:

- Update the base image to `public.ecr.aws/lambda/nodejs:24` (Node 24; `ffc5ae7`)
- `npm ci` → **`npm install -g pnpm@10.34.4 && pnpm install --frozen-lockfile`** (do not use the Corepack path)
- Remove `npx prisma generate`
- esbuild ESM output (`--format=esm`; output files have the `.mjs` extension)
- Build context from the monorepo root (`ContainerImageBuild` `directory` is the repository root)
- **webapp Dockerfile: the LWA version is `public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1`** (updated from 0.9.0 in `5b6cf43`, supports Node 24)
- **webapp Dockerfile: set `ENV AWS_LWA_READINESS_CHECK_PATH="/api/health"`**. Always copy this route (`apps/webapp/src/app/api/health/route.ts`) from the source list. If not copied, the readiness probe returns 404 (LWA may incidentally treat 404 as healthy, but that is not intentional behavior); if `AWS_LWA_READINESS_CHECK_PATH` is not set, the probe runs against `/` and fails with 401/302 because it requires authentication (Issue #188 fix)
- **Include `**/.env.local`in`.dockerignore`.** If `.env.local`enters the Docker image through`COPY apps/webapp/`, Next.js reads it at build time and runtime and it takes precedence over Lambda environment variables (for example, `AMPLIFY_APP_ORIGIN=http://localhost:3011` directs Cognito callbacks to localhost)

### 4-2. Update CDK Constructs

- Add the **dsql-migrator Construct** (`apps/cdk/lib/constructs/dsql-migrator/index.ts`) and the **`apps/db-migrator/` workspace** (handler), but do not deploy them until Phase 5-1
- Add the async-job Lambda function definition
- Remove build steps that depend on v2 `prisma generate` or `prisma db push`
- **Images are built by CodeBuild at deploy time** (the `ContainerImageBuild` construct in `@cdklabs/deploy-time-build`, `393e96c`). The webapp / async-job images share one ARM64 CodeBuild project (`SingletonProject`); dsql-migrator is zip-packaged locally by esbuild. Local `docker build` is not required, but optionally perform 4-3b if you want to detect pnpm-workspace + Docker pitfalls before synth
- **CloudFront flat-rate plan support** (`9bfa073`, [ADR-007](adr-007-cloudfront-flat-rate.md)):
  - Create a WAF Web ACL in `apps/cdk/lib/us-east-1-stack.ts` (scope=CLOUDFRONT, only `AWSManagedRulesKnownBadInputsRuleSet`) and expose its ARN to `MainStack` through a cross-region reference (`crossRegionReferences: true`)
  - Pass `webAclId: virginia.webAclArn` to `MainStack` in `apps/cdk/bin/cdk.ts`
  - Use **managed cache policies only** for the CloudFront distribution: default behavior uses `CachePolicy.CACHING_DISABLED` (does not cache dynamic responses; structurally resolves HTML cache contamination by RSC payloads #176) + `/_next/static/*` uses `CachePolicy.CACHING_OPTIMIZED`
  - **Downstream apps that do not need WAF can opt out**: remove Web ACL creation from `us-east-1-stack.ts` and do not pass `webAclId` from `bin/cdk.ts`; this results in a pay-as-you-go configuration (`webAclId?` is optional in the `Webapp` construct)
- Preserve custom Constructs added by the user. However, if any Construct depends on a VPC, identify it here because its VPC dependency must be removed in Phase 5-3
- **Removal of `database.getLambdaEnvironment()`** (`b2734cc`): The v2 `Database` construct provided `getLambdaEnvironment()`, but it was removed in v3. The API exposed by the v3 `Database` construct consists only of `database.endpoint` (the DSQL endpoint string) and `database.grantConnect(grantee)` (grants `dsql:DbConnectAdmin`). Detect and replace every downstream-app call to `getLambdaEnvironment`:
  ```bash
  rg 'getLambdaEnvironment' apps/cdk
  ```
  For each detected Lambda definition, rewrite `environment: database.getLambdaEnvironment()` to `environment: { DSQL_ENDPOINT: database.endpoint }`, and add `database.grantConnect(handler)` as needed (Secrets Manager references from the Aurora v2 era are unnecessary)
- **RETAIN for Lambda@Edge** (`a3ee713`): `apps/cdk/lib/constructs/cf-lambda-furl-service/edge-function.ts` sets `currentVersionOptions.removalPolicy: RemovalPolicy.RETAIN`. This avoids `DELETE_FAILED` caused by attempting to delete a version before asynchronous CloudFront replica deletion completes. As a side effect, old Lambda@Edge Version resources accumulate; manually clean them up in the Lambda console/CLI after confirming replication has been removed

### Checkpoint

- `cd apps/cdk && pnpm run build` exits with code 0
- `pnpm -r run test:unit` exits with code 0 (if CDK tests exist)
- `rg 'getLambdaEnvironment' apps/cdk` returns no results (no v2 API remains)

### 4-3. Phased builds and functional verification

Static checks (lint, build, tsc) are insufficient. Many issues can crash at runtime even when builds succeed, including eager ESM module evaluation, environment-variable loading, Docker path resolution, and Lambda runtime behavior. Verify progressively in the following order, finding and fixing problems at each stage before proceeding.

#### 4-3a. lint → build

```bash
pnpm -r run lint
pnpm --filter webapp run build
cd apps/cdk && pnpm run build
pnpm -r run test:unit   # if there are CDK tests
```

#### 4-3b. Build local Docker images (optional)

**In v3, production images are built by CodeBuild at deploy time, so local `docker build` is not required for deployment** (`393e96c`, [ADR-006](adr-006-deploy-time-image-build.md)). However, pnpm-workspace + Docker pitfalls cannot be detected at synth time, so if you substantially change a Dockerfile, local verification is recommended before discovering the issue at the cost of CodeBuild.

```bash
# async-job
docker build --platform linux/arm64 -f apps/async-job/Dockerfile -t test-async-job:local .
docker run --rm --entrypoint /bin/sh test-async-job:local -c "ls -la /var/task/"

# db-migrator: zip-packaged `NodejsFunction` (no Dockerfile). Its `migrations/` copy is verified
# via `cdk synth` and the CDK unit tests, not a local `docker build`.

# webapp (can be skipped locally because CodeBuild runs it, but you can still catch Dockerfile syntax errors here)
docker build --platform linux/arm64 -f apps/webapp/Dockerfile -t test-webapp:local .
```

Confirm:

- esbuild output has the `.mjs` extension
- `@aws/aurora-dsql-node-postgres-connector` is included in the bundle (it is not excluded by `--external:@aws-sdk/*`; `@aws/*` and `@aws-sdk/*` are different namespaces)
- The `migrations/` directory is copied correctly into the db-migrator CDK asset (verify via `cdk synth`)

To reproduce the same build process as CDK, after `cdk synth`, obtain the asset hash from `cdk.out/manifest.json` → `dockerImages`, then build with `cd cdk.out/asset.<hash> && docker build --platform linux/arm64 -f <relative Dockerfile path> -t test:local .`.

#### 4-3c. Run local migrations

Run migrations against an actual DSQL cluster. Even if the build succeeds, it may crash during eager ESM module evaluation or `.env` loading.

```bash
pnpm --filter @repo/db run migrate
```

Confirm:

- Migrations succeed and records are inserted into the `_migrations` table
- Reruns are idempotent (already-applied migrations are skipped)

#### 4-3d. Local debug server + browser verification

Set actual Cognito / DSQL / AppSync values in `apps/webapp/.env.local`, start the local server, and operate it in a browser.

```bash
cd apps/webapp && pnpm run dev
```

Confirm:

- The sign-in page displays
- You can sign in with Cognito Managed Login
- Todo CRUD (create, complete, edit, delete) works

## Phase 5: Database migration (Aurora Serverless v2 → DSQL)

This phase requires a phased CDK deploy to prevent data loss. **Do not combine the two deployments in Phases 5-1 and 5-3 into one** — if you delete Aurora v2 resource definitions without setting RETAIN, CloudFormation deletes the cluster and production data is lost. Only after setting RETAIN in Phase 5-1 can you safely remove resource definitions in Phase 5-3.

### Phase 5-1: Create DSQL cluster (first CDK deploy)

1. **Set RemovalPolicy.RETAIN on Aurora v2 resources**: Add `removalPolicy: cdk.RemovalPolicy.RETAIN` to the CDK Aurora Serverless v2 cluster, VPC, and related resources. This changes CloudFormation's `DeletionPolicy` to `Retain`, so actual resources remain even if resource definitions are removed in a later deploy. **Note: `Vpc.applyRemovalPolicy(RETAIN)` does not propagate to child resources (subnets, route tables, internet gateways, and so on).** When retaining a VPC, either enumerate child resources with `vpc.node.findAll()` and set `applyRemovalPolicy(RETAIN)` individually, or use a two-stage deploy when removing VPC resource definitions in Phase 5-3 (first: remove Lambda VPC configuration → second: remove VPC definitions) to wait for ENIs to be released.

2. **Add a DSQL cluster to CDK**: Use the `database.ts` already copied from the v3 kit. The webapp and async-job remain connected to Aurora v2 for now.

3. **Deploy**:
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

**Checkpoint**: The DSQL cluster is ACTIVE (`aws dsql get-cluster --identifier <id>`). The Aurora v2 cluster still exists with data.

### Phase 5-2: Data migration

#### Switch the DSQL connection

Switch `packages/db/.env` to the production DSQL cluster created in Phase 5-1 (overwrite it if the development cluster was configured in Phase 3-6):

```
DSQL_ENDPOINT=<endpoint of the cluster created in Phase 5-1>
AWS_REGION=<region>
```

The endpoint is available from the Phase 5-1 deployment output (`DatabaseClusterEndpoint`) or `aws dsql get-cluster`.

#### Create the schema

Run the migration runner against the DSQL cluster to create tables:

```bash
pnpm --filter @repo/db run migrate
```

#### Migrate data

Choose the migration method for each table based on **both its row count and the match between source/target representations** recorded in Phase 1-3. Choosing based on row count alone risks selecting COPY for a table that requires SERIAL→UUID or array conversion, causing type mismatches and referential inconsistency.

**Method-selection matrix**:

| Condition                                                                                                                                                                                                                                              | Recommended method                 | Reason                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column order, types, ID values, and escape representations fully match between source (v2) and DSQL, and every column falls under “no conversion needed” in Phase 1-3                                                                                  | **Use `COPY FROM STDIN` directly** | You can pass the default output of `pg_dump --data-only` directly to `psql`. For tables exceeding the 3,000-row/transaction limit, split COPY statements by table and run them in individual transactions |
| **Any of the following applies**: SERIAL/BIGSERIAL → UUID; ID-value remapping for FK-equivalent columns from `@relation`; ENUM → text; `String[]` → JSON; conversions other than `JSON`→`jsonb`; type changes for `@default(uuid())` (`uuid` ↔ `text`) | **Explicit mapping in `.mjs`**     | Passing the dump directly to COPY causes type mismatches and referential inconsistency. Choose `.mjs` whenever conversion is required, even for few rows                                                  |
| No conversion is needed, but one table has more than 3,000 rows                                                                                                                                                                                        | **Batch migration in `.mjs`**      | 3,000-row/transaction limit. Split into batches of 500–1,000 rows and commit each batch in an individual transaction                                                                                      |

**DSQL supports `COPY FROM STDIN`**, but when loading `pg_dump --data-only` output, the following transformations are required:

- Remove the `pg_dump` preamble (`SET`, `SELECT pg_catalog.*`, `\restrict`, `\unrestrict`)
- Remove data for the `_prisma_migrations` table (Drizzle uses the `_migrations` table)
- **`String[]` columns**: `pg_dump` emits PostgreSQL array literals in `{}` form. Drizzle stores them as JSON strings in `[]` form in a `text` column, so conversion from `{}` → `[]` is required. Without conversion, `JSON.parse('{}')` returns an object `{}`, causing errors where it is handled as an array (once conversion is required, this table is unsuitable for direct COPY input — choose `.mjs`)

The v3 migration runner supports `.sql` and `.mjs`. The runner ignores `.ts` so that local and Lambda environments execute the same committed files without transformation (see [ADR-005](adr-005-migration-file-format.md)). Create a `.mjs` file for data migration in `packages/db/migrations/` and implement it in the following form (supplement types with JSDoc):

```js
/**
 * @param {import('pg').PoolClient} client
 * @param {import('../src/migrate').MigrationContext} context
 *   context.region lets you build AWS SDK clients (for example, when using external resources such as S3 backups).
 *   If unused, the second argument can be omitted (`function(client)` also works).
 */
export default async function (client, context) {
  // Convert the Phase 1-2 dump data to DSQL-compatible form and INSERT
  // SERIAL PK → UUID value (also update FK columns in referencing tables to the same UUID)
  // ENUM value → TEXT value (the string value itself is the same)
  //
  // Beware of the 3,000-rows-per-transaction limit — batch in chunks of 500–1,000 rows
  await client.query('BEGIN');
  await client.query(`INSERT INTO "TableName" (...) VALUES ...`);
  await client.query('COMMIT');
}
```

**When adding AWS resource references to `MigrationContext`** (for example, an S3 backup bucket), update the following four locations in sync (procedure when adding something other than the default `region`):

1. Add a field to the `MigrationContext` interface (`packages/db/src/migrate.ts`)
2. Inject the value in the local runner (`packages/db/src/migrate-cli.ts`)
3. Inject the value in the Lambda runner (`apps/db-migrator/src/handler.ts`)
4. Grant the corresponding IAM permissions and environment variables to the migrator Lambda in the `DsqlMigrator` Construct (`apps/cdk/lib/constructs/dsql-migrator/index.ts`)

**Risk of re-executing `.mjs` file names** (`56f7be4`, [ADR-005](adr-005-migration-file-format.md)): The runner records **the file name (including extension)** in the `_migrations` table. Renaming an already-applied `.mjs` makes it a separate file and executes it again. When inheriting `.ts` migrations from v2, choose one of the following:

- **If unapplied, only rename**: Rename `0002_x.ts` → `0002_x.mjs` and rewrite its contents in `.mjs` form
- **If applied, rerun mitigation is required**: First rewrite the name with `UPDATE _migrations SET name = '0002_x.mjs' WHERE name = '0002_x.ts'`, or make the migration itself idempotent (the same result no matter how many times it runs) before redeploying

For very large tables, see [Agentic migration with AI tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html).

#### Verify data integrity

For each table, compare row counts between Aurora v2 and DSQL:

```sql
-- On Aurora v2
SELECT count(*) FROM "TableName";
-- On DSQL
SELECT count(*) FROM "TableName";
```

**Checkpoint**: Row counts for all tables match between Aurora v2 and DSQL.

### Phase 5-3: Application cutover (second CDK deploy)

1. **Update CDK**: Remove Aurora v2 resource definitions (actual resources remain because RETAIN is set). Change webapp and async-job environment variables to the DSQL endpoint. Remove VPC configuration from Lambda functions. If there are custom VPC-dependent Constructs identified in Phase 4-2, remove their VPC dependency here.

2. **Deploy** (a maintenance window is recommended in production):

   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

3. **VPC ENI cleanup** (dangerous operation — user explicit approval required): When Lambda functions are removed from a VPC, Hyperplane ENIs remain in `available` state for up to 20 minutes, blocking security-group and subnet deletion. If CloudFormation reports `DELETE_FAILED`, clean up **only ENIs/SGs owned by the stack being migrated** using the following procedure. **Do not unconditionally delete `available` ENIs throughout the region** — doing so risks accidentally deleting ENIs/SGs used by other workloads.
   1. Identify the failing VPC ID and security-group ID from the `DELETE_FAILED` CloudFormation event:
      ```bash
      aws cloudformation describe-stack-events --stack-name <stack> --region <region> \
        --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].[LogicalResourceId,PhysicalResourceId,ResourceStatusReason]" \
        --output table
      ```
   2. List candidates only for `available` ENIs with the target SG attached in the target VPC:
      ```bash
      aws ec2 describe-network-interfaces \
        --filters "Name=vpc-id,Values=<target-vpc-id>" \
                  "Name=group-id,Values=<target-sg-id>" \
                  "Name=status,Values=available" \
                  "Name=description,Values=AWS Lambda VPC ENI*" \
        --region <region> \
        --query "NetworkInterfaces[].[NetworkInterfaceId,VpcId,Groups[].GroupId,Description]" \
        --output table
      ```
   3. **Present the output to the user** and delete only after obtaining explicit approval:
      ```bash
      aws ec2 delete-network-interface --network-interface-id <eni-id> --region <region>
      aws ec2 delete-security-group --group-id <sg-id> --region <region>
      ```
   4. For an ENI whose VpcId or Groups cannot be verified, or an ENI tied to resources other than the target stack, **do not delete it; wait 20 minutes, redeploy, and switch to individual investigation**

**Checkpoint**: The application works end to end through DSQL — sign-in, CRUD operations, and async jobs with real-time notifications.

### Phase 5-4: Remove old resources (third CDK deploy — or manually)

⚠️ **Point of no return. Request the user's explicit confirmation before proceeding.**

1. Delete the retained Aurora v2 cluster, VPC, NAT Instance, and Bastion Host
2. You can perform this with CDK (remove retained resources and deploy) or manually with the AWS console/CLI

**Checkpoint**: Old resources are deleted. No VPC cost remains.

## Phase 6: Manual post-deployment work

### Enroll in the CloudFront Free plan (recommended)

v3 associates a WAF Web ACL (scope=CLOUDFRONT; only `AWSManagedRulesKnownBadInputsRuleSet`) with the CloudFront distribution — a requirement for enrolling in the [flat-rate plan](https://aws.amazon.com/cloudfront/pricing/) ([ADR-007](adr-007-cloudfront-flat-rate.md)). Because CDK does not support enrollment, perform the following manually:

1. Open the target distribution in the CloudFront console
2. Select **Manage subscription → Free plan** to enroll ($0/month, free up to 1M requests + 100 GB/month)

⚠️ **Until enrollment, WAF is billed at [standard pricing](https://aws.amazon.com/waf/pricing/) ($5/month + $1 × number of rules).** Enroll immediately after deployment, or do one of the following:

- **Enroll** (recommended): Enroll from the CloudFront console in any Free / Pro / Business / Premium plan. Even Free includes up to 1M requests + 100 GB/month at no charge
- **Remove WAF (opt out)**: Remove the Web ACL creation section from `apps/cdk/lib/us-east-1-stack.ts`, and also remove the `webAclId` property passed to `MainStack` in `apps/cdk/bin/cdk.ts`. `webAclId?` is optional, so removal alone works. See [README](../../../README.md#cloudfront-flat-rate-pricing-plan) for details

Plan scope: **CloudFront-side usage only**. Lambda / Lambda@Edge (all dynamic requests are cache-missed) are billed separately.
