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
- _Turborepo + pnpm_: It adds task orchestration and caching, but the kit has only a handful of workspaces (currently seven) and a simple dependency chain. At this scale, Turborepo configuration overhead is not justified. Users can add it later if needed.

## Consequences

- **Docker install is unfiltered**: The `pnpm install` step in the Docker builder stage runs `pnpm install --frozen-lockfile` with no `--filter`. This is about the _install_ only — `pnpm --filter <pkg> run <script>`, which scopes task execution, is used normally elsewhere (dev, migrations, CI). pnpm's default isolated `node_modules` exposes only each package's _declared_ dependencies (transitive ones live in the `.pnpm` virtual store), so `next build` / `esbuild --bundle` must resolve the full transitive graph from disk. Scoping the install with `--filter` risks leaving transitive dependencies unmaterialized, and gains nothing here because the builder's `node_modules` is discarded — the runtime image copies only the bundled output.
- **`.dockerignore` + `ignoreMode`**: CDK's Docker image asset does read `.dockerignore` and auto-excludes `cdk.out`, but by default interprets exclude patterns with GLOB semantics rather than Docker's. With the repo root as build context, set `ignoreMode: IgnoreMode.DOCKER` for all Docker assets so patterns match the actual `docker build` and the deep pnpm `node_modules` tree is not staged (otherwise staging can fail, e.g. `ENAMETOOLONG`). Applies to `ContainerImageBuild` and `DockerImageAsset` alike.
- **ESM + Lambda**: Output from esbuild `--format=esm` requires the `.mjs` extension in Lambda. The Node.js runtime loads it as CommonJS unless it has `.mjs` or `"type": "module"` in `package.json`.
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` does not exclude `@aws/aurora-dsql-node-postgres-connector`. The Lambda runtime provides only `@aws-sdk/*`. Other `@aws/*` packages must be bundled.
