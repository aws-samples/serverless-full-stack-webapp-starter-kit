# v3.0.0 Architecture Decision Records

## ADR-001: Aurora DSQL + Drizzle ORM + Custom migration runner

### Status

Accepted (v3.0.0)

### Context

The v2 architecture had three compounding problems:

1. **VPC cost and complexity**: Aurora Serverless v2 requires a VPC with NAT (Instance or Gateway) for Lambda access. The NAT Instance alone costs ~$30/month — disproportionate for a starter kit targeting under $10/month. VPC also introduces operational overhead: security groups, subnets, and Lambda Hyperplane ENI lifecycle issues during deployment changes.
2. **Prisma binary overhead**: `prisma generate` produces platform-specific query engine binaries. In a monorepo, every package importing the Prisma client needs its own generate step. The binary also inflates Docker images and complicates cross-platform builds.
3. **Monorepo sharing friction**: With Prisma's binary generation and Aurora's VPC requirement, extracting shared database code into a monorepo package required solving both problems simultaneously — or accepting throwaway work.

These three problems form a dependency chain: solving the monorepo structure (1) requires solving Prisma sharing (2), and the most impactful improvement — eliminating VPC cost (3) — requires changing the database engine, which in turn makes the ORM choice moot. Solving all three together avoids intermediate waste.

### Decision

**Database: Aurora DSQL** — a serverless distributed SQL database that requires no VPC. Lambda connects over the public internet with IAM authentication. True pay-per-request pricing (read/write RPUs) with zero cost at zero traffic.

**ORM: Drizzle ORM** — a pure TypeScript ORM with no code generation step. `relations()` defines relationships for the query builder without generating SQL-level foreign keys, naturally fitting DSQL's no-FK constraint. Schema files are regular TypeScript that can be imported across monorepo packages.

**Migration runner: Custom implementation** — drizzle-kit's built-in migration tools are incompatible with DSQL:
- `drizzle-kit migrate` executes all pending migrations in a single transaction, violating DSQL's 1-DDL-per-transaction constraint.
- `drizzle-kit push` ignores DSQL constraints entirely.

The custom runner follows Drizzle's documented "Option 5" (generate SQL with drizzle-kit, apply with external tool) and the same approach as Vercel's aws-dsql-movies-demo. It splits SQL on blank lines, executes each statement in its own transaction, and tracks state in a `_migrations` table.

The runner is structured in three layers for portability:
- Core logic (`packages/db/src/migrate.ts`): receives `pg.Pool`, no framework dependencies
- Lambda handler: thin wrapper for CDK Trigger execution
- CDK Construct: `DockerImageFunction` + Trigger for deploy-time automation

#### Rejected alternatives

**Database:**
- *Aurora Serverless v2 (keep)*: Retains VPC cost and complexity. The starter kit's value proposition is minimal operational overhead.
- *DynamoDB*: Single-table design has a steep learning curve. SQL is more accessible for the kit's target audience (developers new to serverless).
- *Neon*: Third-party dependency. The kit targets AWS-native services for consistency with the CDK deployment model.

**ORM:**
- *Prisma + aurora-dsql-prisma-tools*: Requires `prisma generate` (binary overhead persists), and `@relation` assumes FK support — aurora-dsql-prisma-tools must strip FK statements from generated SQL. Prisma 7's Rust → TypeScript architecture migration introduces additional uncertainty.
- *Kysely*: Pure TypeScript query builder, but lacks Drizzle's `relations()` API for declarative relationship definitions. Would require manual join construction.
- *Raw SQL*: No type safety. Defeats the kit's goal of end-to-end type safety from DB to React components.

**Migration runner:**
- *drizzle-kit migrate*: Executes all migrations in one transaction — fundamentally incompatible with DSQL's 1-DDL-per-transaction constraint.
- *drizzle-kit push*: Ignores DSQL constraints (generates non-ASYNC indexes, FK statements, etc.).
- *Flyway*: JVM dependency. Adds operational complexity for a Node.js/TypeScript project. (Flyway did add DSQL dialect support in Feb 2026, but the JVM requirement remains.)

### Consequences

- **DDL constraint propagation**: DSQL's constraints (no FK, no SERIAL, no JSON/JSONB, limited ALTER TABLE) affect schema design, linting rules, and migration tooling. A two-layer detection strategy (oxlint for schema definitions, SQL validation for generated migrations) is required.
- **Migration runner maintenance**: The custom runner is additional code to maintain. However, it is ~200 lines of core logic with comprehensive tests (unit + integration).
- **Drizzle DSQL support gap**: Drizzle's official DSQL support is not yet released (drizzle-team/drizzle-orm#5248). drizzle-kit generate does not account for DSQL constraints — output requires auto-transformation (`CREATE INDEX` → `CREATE INDEX ASYNC`, FK removal) and validation.
- **Table recreation for schema changes**: DSQL's limited ALTER TABLE support (no DROP COLUMN, no ALTER COLUMN TYPE, no SET/DROP NOT NULL/DEFAULT) means many schema changes require table recreation with data migration. The runner supports `.ts` migration files for batch data operations.

---

## ADR-002: pnpm workspaces monorepo

### Status

Accepted (v3.0.0)

### Context

In v2, `webapp/` contained Next.js, async jobs, and the migration runner in a single package. The async-job Dockerfile ran `npm ci` and pulled in all webapp dependencies (React, Next.js, UI libraries) despite needing only the job handler and its database dependencies. This inflated image size and build time.

Extracting async jobs and database code into separate packages requires a monorepo tool. The package manager choice also affects Docker build behavior, dependency resolution strictness, and CI performance.

### Decision

pnpm workspaces in strict mode (no `shamefully-hoist`). The monorepo is structured as:

```
apps/           # deployable applications (webapp, async-job, cdk)
packages/       # shared libraries (db, shared-types)
```

Internal packages use the `@repo/` scope. Apps do not depend on each other.

#### Rejected alternatives

- *npm workspaces*: Flat `node_modules` silently resolves undeclared dependencies, masking missing dependency declarations that break in Docker builds. pnpm's strict mode catches these at install time.
- *Turborepo + pnpm*: Turborepo adds task orchestration and caching, but the kit has only 5 packages with simple dependency chains. The overhead of Turborepo configuration is not justified at this scale. Users can add it later if needed.

### Consequences

- **Docker `--filter` limitation**: `pnpm install --filter` does not hoist transitive dependencies of workspace packages in strict mode. Dockerfiles must use `pnpm install --frozen-lockfile` without `--filter`, installing all workspace dependencies.
- **`.dockerignore` + `ignoreMode`**: CDK's `DockerImageCode.fromImageAsset` does not read `.dockerignore` by default. `ignoreMode: IgnoreMode.DOCKER` is required on every Docker asset to prevent `cdk.out` from being recursively copied (`ENAMETOOLONG`).
- **ESM + Lambda**: esbuild `--format=esm` output requires `.mjs` extension for Lambda. The Node.js runtime defaults to CommonJS without `.mjs` or `"type": "module"` in `package.json`.
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` does not exclude `@aws/aurora-dsql-node-postgres-connector`. Lambda runtime only provides `@aws-sdk/*`; other `@aws/*` packages must be bundled.

---

## ADR-003: oxlint + oxfmt

### Status

Accepted (v3.0.0)

### Context

The kit needs linting rules to catch DSQL-incompatible patterns at coding time — specifically, `no-restricted-imports` to block `serial`, `json`, `jsonb` imports from `drizzle-orm/pg-core`. Linter speed matters for developer experience and CI time, especially as the monorepo grows.

### Decision

Replace ESLint + Prettier with oxlint + oxfmt. oxlint provides the required `no-restricted-imports` rule with significantly faster execution (Rust-based). oxfmt replaces Prettier for formatting.

DSQL-specific rules configured:
- `no-restricted-imports`: blocks `serial`, `smallserial`, `bigserial`, `json`, `jsonb` from `drizzle-orm/pg-core`
- `no-restricted-syntax`: blocks `.references()` calls in schema files (configured but inactive — see Consequences)

#### Rejected alternatives

- *ESLint + Prettier (keep)*: Slower execution. ESLint's ecosystem is larger, but the kit only needs a small subset of rules. The speed difference is noticeable in CI and editor feedback.
- *Biome*: Rust-based linter + formatter (single tool). However, Biome does not support `no-restricted-imports` with the granularity needed (blocking specific named imports from a module). oxlint's implementation matches ESLint's rule semantics.

### Consequences

- **`no-restricted-syntax` not supported**: As of oxlint v1.56.0, `no-restricted-syntax` is not implemented. The `.references()` call restriction is configured in `oxlintrc.json` but inactive. It will automatically activate when oxlint adds support. Until then, SQL-level validation in `check-dsql-compat.ts` (detecting `REFERENCES`/`FOREIGN KEY` in generated SQL) serves as the fallback.
- **Smaller rule ecosystem**: oxlint supports fewer rules than ESLint. For the kit's needs (Next.js plugin, TypeScript, import restrictions), coverage is sufficient. Users who need additional ESLint rules can add ESLint alongside oxlint.
