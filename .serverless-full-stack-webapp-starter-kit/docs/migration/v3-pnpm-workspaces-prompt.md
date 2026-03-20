# v3 Migration Guide: pnpm Workspaces + DSQL + Drizzle

This guide covers the major changes in v3 for users migrating from v2.

## Breaking changes

### 1. Package manager: npm → pnpm workspaces

The project is now a pnpm monorepo. All `npm` commands should be replaced with `pnpm`.

- `npm ci` → `pnpm install`
- `npm run build` → `pnpm run build`
- `package-lock.json` → `pnpm-lock.yaml`

### 2. ORM: Prisma → Drizzle

Prisma has been replaced with Drizzle ORM for DSQL compatibility.

Key differences:
- No `prisma generate` step — Drizzle is pure TypeScript
- Schema defined in `packages/db/src/schema.ts` using Drizzle's `pgTable()` API
- Relations use `relations()` (query builder only, no SQL-level FK)
- Zod schemas are hand-written, not generated from the ORM

Migration steps for custom code:
1. Replace `@prisma/client` imports with `@repo/db/client` and `@repo/db/schema`
2. Replace `prisma.model.findMany()` with `db.query.model.findMany()` or `db.select().from(table)`
3. Replace `prisma.model.create()` with `db.insert(table).values()`
4. Replace `prisma.model.update()` with `db.update(table).set().where()`
5. Replace `prisma.model.delete()` with `db.delete(table).where()`

### 3. Database: Aurora Serverless v2 → Aurora DSQL

Aurora Serverless v2 (VPC-bound) has been replaced with Aurora DSQL (VPC-free).

Key differences:
- No VPC, NAT Instance, or Bastion Host required
- IAM authentication instead of username/password
- DSQL constraints: no SERIAL, no FK, no JSON/JSONB, 1 DDL per transaction
- `CREATE INDEX` must use `ASYNC` keyword

### 4. VPC removal

The entire VPC stack has been removed. Lambda functions connect to DSQL over the public internet with IAM authentication.

### 5. Project structure

```
# v2
webapp/          → apps/webapp/
cdk/             → apps/cdk/
                   apps/async-job/     (new, extracted from webapp/src/jobs/)
                   packages/db/        (new, Drizzle schema + migration runner)
                   packages/shared-types/ (new, job payload types)
```

### 6. Linting: ESLint + Prettier → oxlint + oxfmt

ESLint and Prettier have been replaced with oxlint and oxfmt for faster linting.

### 7. Docker builds in pnpm monorepo (strict mode, no shamefully-hoist)

Key constraints when building Docker images from a pnpm workspace without `shamefully-hoist`:

- **`pnpm install --filter` does not hoist transitive dependencies of workspace packages.** If `apps/async-job` depends on `@repo/db`, and `@repo/db` depends on `pg`, esbuild inside Docker cannot resolve `pg` from `apps/async-job/node_modules`. Use `pnpm install --frozen-lockfile` (no `--filter`) in Dockerfiles.
- **CDK `DockerImageCode.fromImageAsset` does not read `.dockerignore` by default.** Set `ignoreMode: IgnoreMode.DOCKER` on every Docker asset whose build context is the monorepo root. Without this, `cdk.out` is recursively copied into itself, causing `ENAMETOOLONG`.
- **esbuild `--format=esm` output requires `.mjs` extension for Lambda.** The Lambda Node.js runtime loads handlers as CommonJS unless the file has `.mjs` extension or a `package.json` with `"type": "module"` exists in `/var/task`.
- **`@aws/*` ≠ `@aws-sdk/*`.** `--external:@aws-sdk/*` does not exclude `@aws/aurora-dsql-node-postgres-connector`. Lambda runtime only provides `@aws-sdk/*`; other `@aws/*` packages must be bundled by esbuild.
