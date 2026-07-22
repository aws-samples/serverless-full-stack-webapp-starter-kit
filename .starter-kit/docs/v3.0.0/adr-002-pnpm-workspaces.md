# ADR-002: pnpm workspaces monorepo

## Status

Accepted (v3.0.0)

## Context

In v2, Next.js, asynchronous jobs, and the migration runner coexist in a single package under `webapp/`. Although `job.Dockerfile` is separate, there is only one `package.json`, so `npm ci` installs all webapp dependencies (React, Next.js, aws-amplify, etc.), increasing image size and build time.

A monorepo tool is required to extract asynchronous jobs and DB code into separate packages. The choice of package manager also affects Docker build behavior, dependency resolution strictness, and CI performance.

## Decision

Use pnpm workspaces in strict mode (without `shamefully-hoist`).

```
apps/           # deployable applications (webapp, async-job, cdk)
packages/       # shared libraries (db, shared-types)
```

Internal packages use the `@repo/` scope. Applications do not depend on each other.

### Rejected alternatives

- _npm workspaces_: A flat `node_modules` implicitly resolves undeclared dependencies and hides undeclared dependencies that break in Docker builds. pnpm strict mode detects these during installation.
- _Turborepo + pnpm_: It adds task orchestration and caching, but the kit has only five packages and a simple dependency chain. At this scale, Turborepo configuration overhead is not justified. Users can add it later if needed.

## Consequences

- **Docker `--filter` limitation**: In strict mode, `pnpm install --filter` does not hoist transitive dependencies of workspace packages. Dockerfiles must install all workspace dependencies with `pnpm install --frozen-lockfile` without `--filter`.
- **`.dockerignore` + `ignoreMode`**: CDK's `DockerImageCode.fromImageAsset` does not read `.dockerignore` by default. `ignoreMode: IgnoreMode.DOCKER` is required for all Docker assets to prevent recursive copying of `cdk.out` (`ENAMETOOLONG`).
- **ESM + Lambda**: Output from esbuild `--format=esm` requires the `.mjs` extension in Lambda. The Node.js runtime loads it as CommonJS unless it has `.mjs` or `"type": "module"` in `package.json`.
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` does not exclude `@aws/aurora-dsql-node-postgres-connector`. The Lambda runtime provides only `@aws-sdk/*`. Other `@aws/*` packages must be bundled.
