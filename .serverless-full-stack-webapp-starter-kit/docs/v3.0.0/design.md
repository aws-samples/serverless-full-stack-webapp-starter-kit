# v3.0.0 Design Document

## Overview

v3 replaces the database engine (Aurora Serverless v2 → Aurora DSQL), ORM (Prisma → Drizzle), package manager (npm → pnpm workspaces), and linter (ESLint + Prettier → oxlint + oxfmt). These four changes are interdependent — solving them together avoids wasted effort on intermediate states (e.g., making Prisma work in a monorepo when it will be replaced anyway).

## Motivation

v2 had three structural problems:

1. **Code co-location**: `webapp/` contained Next.js, async jobs, and the migration runner. The async-job Dockerfile pulled in all webapp dependencies, inflating image size and build time.
2. **Prisma binary overhead**: `prisma generate` produces platform-specific binaries that complicate monorepo sharing. Every package that imports the Prisma client needs its own generate step.
3. **VPC requirement**: Aurora Serverless v2 requires a VPC with NAT (Instance or Gateway) for Lambda access. This adds ~$30/month baseline cost and operational complexity (security groups, subnets, ENI lifecycle) that is disproportionate for a starter kit.

Solving (1) alone (monorepo extraction) would force us to solve Prisma's binary sharing problem — effort that becomes throwaway once we migrate to Drizzle. Solving (2) alone (Drizzle migration) still leaves the VPC cost. Solving all three together — monorepo + Drizzle + DSQL — eliminates each problem without intermediate waste.

## Target architecture

```
pnpm-workspace.yaml
package.json                      # root (scripts, devDependencies only)
apps/
  cdk/                            # CDK infrastructure
  webapp/                         # Next.js app (no jobs, no migration runner)
  async-job/                      # Extracted from webapp/src/jobs/
packages/
  db/                             # Drizzle schema, client, migration SQL, migration runner
  shared-types/                   # Job payload types (Zod schemas)
```

Dependency direction:

```
apps/webapp       → @repo/shared-types → @repo/db
apps/async-job    → @repo/shared-types → @repo/db
apps/cdk          (no direct dependency — references Docker build paths only)
```

Apps do not depend on each other. Internal packages use the `@repo/` scope.

## Key design decisions

### Aurora DSQL

Intent: eliminate VPC, achieve true pay-per-request, simplify authentication.

DSQL requires no VPC — Lambda connects over the public internet with IAM authentication. This removes NAT Instance cost, security group management, and the ENI lifecycle issues that plague VPC-attached Lambda functions. Pay-per-request pricing (read/write RPUs) means zero cost at zero traffic, unlike Aurora Serverless v2's minimum 0.5 ACU (~$43/month).

Trade-offs accepted: DSQL has significant DDL constraints (1 DDL per transaction, no FK, no SERIAL, no JSON/JSONB, limited ALTER TABLE). These constraints propagate through the entire stack — schema design, ORM choice, migration tooling, and linting rules.

### Drizzle ORM

Intent: pure TypeScript ORM that naturally fits DSQL's constraints.

Drizzle was chosen over Prisma for three reasons:

1. **No code generation**: Drizzle is pure TypeScript — no `prisma generate` step, no platform-specific binaries. Schema definitions are regular TypeScript files that can be imported across monorepo packages without any build step.
2. **`relations()` fits DSQL's no-FK constraint**: Drizzle's `relations()` API defines relationships for the query builder without generating SQL-level foreign keys. Prisma's `@relation` assumes FK support; using it with DSQL requires `aurora-dsql-prisma-tools` to strip FK statements from generated SQL — an extra tool in the chain.
3. **Prisma 7 uncertainty**: Prisma 7 is undergoing a Rust → TypeScript architecture migration, with reported performance regressions in high-concurrency small-query workloads. Adopting Drizzle avoids this risk.

Drizzle's official DSQL support is not yet released (drizzle-team/drizzle-orm#5248), but it works via node-postgres. The risk is mitigated by two-layer DSQL compatibility checking (oxlint + SQL validation).

### Custom migration runner

Intent: three-layer separation (core logic / Lambda handler / CDK Construct) for portability and testability.

`drizzle-kit migrate` executes all pending migrations in a single transaction — fundamentally incompatible with DSQL's 1-DDL-per-transaction constraint. `drizzle-kit push` ignores DSQL constraints entirely. This is Drizzle's documented "Option 5": generate SQL with drizzle-kit, apply with an external tool.

The runner splits SQL files on blank lines (`\n\n`) and executes each statement in its own `BEGIN`/`COMMIT`. A `_migrations` table tracks applied migrations by name. `already exists` errors are skipped for idempotency.

The three-layer design:

- **Core logic** (`packages/db/src/migrate.ts`): receives a `pg.Pool`, reads SQL files, executes them. No dependency on CDK, Lambda, or Drizzle. Reusable with any ORM or deployment tool.
- **Lambda handler** (`apps/cdk/lib/constructs/dsql-migrator/handler.ts`): thin wrapper that creates a Pool from Lambda environment variables and calls `migrate()`.
- **CDK Construct** (`apps/cdk/lib/constructs/dsql-migrator/index.ts`): `DockerImageFunction` + CDK Trigger for automatic execution on `cdk deploy`.

### DSQL compatibility strategy

Intent: catch DSQL-incompatible patterns at two levels — coding time and migration time.

**Layer 1 — oxlint (schema definition level)**: `no-restricted-imports` blocks `serial`, `smallserial`, `bigserial`, `json`, `jsonb` imports from `drizzle-orm/pg-core`. Developers get immediate feedback in their editor and CI. (`no-restricted-syntax` for `.references()` is configured but not yet functional in oxlint v1.56.0.)

**Layer 2 — SQL validation (generated SQL level)**: `check-dsql-compat.ts` auto-transforms drizzle-kit output (statement-breakpoint → blank lines, `CREATE INDEX` → `CREATE INDEX ASYNC`, FK removal) and validates against patterns that cannot be auto-fixed (`ALTER COLUMN TYPE`, `DROP COLUMN`, `SET/DROP NOT NULL`, `SET/DROP DEFAULT`, `DROP CONSTRAINT`, `SERIAL`, `TRUNCATE`). Unfixable patterns produce an error with instructions to use `drizzle-kit generate --custom` for manual table recreation.

### pnpm workspaces

Intent: strict dependency isolation without `shamefully-hoist`.

pnpm's strict mode ensures each package only accesses its declared dependencies. This catches missing dependency declarations that npm's flat `node_modules` would silently resolve.

Docker build constraints in strict mode:
- `pnpm install --filter` does not hoist transitive dependencies of workspace packages. Dockerfiles use `pnpm install --frozen-lockfile` without `--filter`.
- CDK's `DockerImageCode.fromImageAsset` does not read `.dockerignore` by default. `ignoreMode: IgnoreMode.DOCKER` is required on every Docker asset to prevent `cdk.out` from being recursively copied.
- esbuild `--format=esm` output requires `.mjs` extension for Lambda (Node.js runtime defaults to CommonJS).
- `--external:@aws-sdk/*` does not exclude `@aws/*` packages like `@aws/aurora-dsql-node-postgres-connector`.

### oxlint + oxfmt

Intent: faster linting with DSQL-specific rules.

oxlint provides the `no-restricted-imports` rule needed for DSQL compatibility checking, with significantly faster execution than ESLint. oxfmt replaces Prettier for formatting.

Limitation: `no-restricted-syntax` is not yet supported in oxlint (v1.56.0). The `.references()` call restriction is configured in `oxlintrc.json` but inactive until oxlint adds support. SQL-level validation in `check-dsql-compat.ts` serves as the fallback.

## Known constraints and trade-offs

- **DSQL DDL constraints**: 1 DDL per transaction, no FK, no SERIAL/SEQUENCE (use IDENTITY), no JSON/JSONB (use TEXT), `CREATE INDEX ASYNC` only, limited ALTER TABLE (ADD COLUMN, RENAME, identity operations only), 3,000 rows per write transaction, no TRUNCATE, no triggers, no PL/pgSQL.
- **Drizzle DSQL support**: Not officially released (drizzle-team/drizzle-orm#5248). Works via node-postgres. drizzle-kit generate does not account for DSQL constraints — output requires auto-transformation and validation.
- **oxlint `no-restricted-syntax`**: Not supported as of v1.56.0. `.references()` detection relies on SQL-level validation until oxlint adds this rule.
- **DSQL region availability**: DSQL is not available in all AWS regions. Users must deploy to a supported region.
- **ESM immediate evaluation**: `client.ts` uses Proxy-based lazy initialization to prevent `db` from being initialized at module load time, which would crash CLI tools that import from the same module.
