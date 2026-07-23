# AGENTS.md

## Commands

```bash
# install all dependencies
pnpm install

# webapp
cd apps/webapp && pnpm run dev          # starts on port 3010
cd apps/webapp && pnpm run build
cd apps/webapp && pnpm run lint

# cdk
cd apps/cdk && pnpm run build
cd apps/cdk && pnpm run test:unit
cd apps/cdk && pnpm exec cdk deploy --all
cd apps/cdk && pnpm exec cdk diff

# db migration (requires DSQL cluster)
pnpm --filter @repo/db run migrate

# lint / test across all workspaces (from root)
pnpm -r run lint
pnpm -r run test:unit

# local development (requires DSQL cluster)
pnpm --filter @repo/db run cluster create   # create dev DSQL cluster
cd apps/webapp && pnpm run dev
```

## Development guide

### Authentication

All server-side mutations must go through `authActionClient` (defined in `lib/safe-action.ts`). It validates the Cognito session via Amplify server-side auth and injects `ctx.userId`. Never call Drizzle directly from a Server Action without this middleware.

API Routes (`app/api/**/route.ts`) that require authentication must go through `withAuth()` (defined in `lib/api/with-auth.ts`) — the equivalent guardrail for Route Handlers. It resolves the session and returns 401 when unauthenticated; the handler receives the session and its return value is JSON-encoded. Validate inputs with Zod `safeParse`, same as Server Actions. Public routes (LWA readiness at `api/health/`, Cognito auth callbacks at `api/auth/[slug]/`) are the intentional exceptions and do not use `withAuth()`.

`proxy.ts` handles route protection (redirect to `/sign-in` for unauthenticated users). It is the Next.js 16 [proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — the rename of `middleware.ts`, which was deprecated in Next.js 16. Under Lambda Web Adapter it runs inside the Node.js Lambda runtime (same process as the request handler), so there is no separate Edge worker. Do not create `middleware.ts`; it is superseded by `proxy.ts`.

### Async jobs

The dispatch flow is: Server Action → `runJob()` (Lambda async invoke) → `apps/async-job/src/handler.ts` (discriminated union dispatch) → job handler → `sendEvent()` (AppSync Events) → client `useEventBus` hook.

To add a new job:

1. Add a Zod schema with a `type` literal to the discriminated union in `packages/shared-types/src/job-payload.ts`
2. Implement the handler in `apps/async-job/src/jobs/`
3. Add the case to the switch statement in `apps/async-job/src/handler.ts`

### Database

The project uses Aurora DSQL with Drizzle ORM. Schema is defined in `packages/db/src/schema.ts`.

> **Note:** The DSQL constraints below are a point-in-time snapshot. Aurora DSQL continues to relax its limits (for example, `json`/`jsonb` were unsupported at launch and added in 2026), so verify the current constraints against the [Aurora DSQL documentation](https://docs.aws.amazon.com/aurora-dsql/) or the `dsql` agent skill before relying on them.

DSQL constraints:

- No SERIAL/SEQUENCE — use UUID
- No FOREIGN KEY — use Drizzle `relations()` for query builder joins
- JSON: `json`/`jsonb` are supported (stored compressed; 1 MiB compressed-size limit) but **not indexable** — extract fields you filter or sort on into their own columns. Prefer `jsonb`.
- No TRUNCATE — use `DELETE FROM` instead
- CREATE INDEX must use ASYNC keyword
- 1 DDL per transaction
- ALTER TABLE only supports: ADD COLUMN, RENAME COLUMN/TABLE/CONSTRAINT, SET SCHEMA, OWNER TO, and IDENTITY operations. Everything else (DROP COLUMN, ALTER COLUMN TYPE, SET/DROP NOT NULL, SET/DROP DEFAULT, DROP CONSTRAINT) requires table recreation.

- `db.query.*.findMany()` with `exists()`/`sql` subqueries causes alias errors on DSQL (drizzle-team/drizzle-orm#3068). Use `db.select().from()` instead. `findFirst()` is safe.
- Drizzle relational queries can't do `_count` or nested `where` on relations. For list views needing cross-table aggregates or per-row flags, batch-fetch by ids (one query per related table) and merge in JS — never per-row queries (N+1).
- No FK cascade. Delete children explicitly. Default: wrap the deletes in `db.transaction()`. Exception: if a delete can exceed the 3,000-row/transaction limit, batch it in chunks across separate transactions (`DELETE ... WHERE id IN (SELECT id ... LIMIT n)` — DSQL has no `DELETE ... LIMIT`).

### Database migration

See `packages/db/README.md` for full usage. Key rules:

- `pnpm --filter @repo/db run generate` — generates and auto-transforms SQL for DSQL.
- `pnpm --filter @repo/db run migrate` — applies migrations (1 DDL per transaction).
- Do not use `drizzle-kit push` or `drizzle-kit migrate` — they violate DSQL's 1 DDL/transaction constraint.
- When `generate` errors on unfixable patterns (DROP COLUMN, ALTER COLUMN TYPE, etc.): run `git checkout -- migrations/`, then `pnpm --filter @repo/db exec drizzle-kit generate --custom --name=<name>`, and write table recreation SQL or a `.mjs` batch migration manually.
- Data migrations are `.mjs` (`export default async function(client, context)`); the runner does not support `.ts`. The optional `context` injects AWS resources (e.g. an S3 bucket name) into migrations that need them.
- Never hand-create migration files outside the `generate` / `generate --custom` flow — it forks the snapshot chain (duplicate `prevId`) and makes `generate` abort. `check:ci` runs `drizzle-kit check` to catch chain forks and snapshot/`schema.ts` desync.

### Lambda environment

The webapp runs on Lambda behind CloudFront via Lambda Web Adapter (response streaming). `next.config.ts` uses `output: 'standalone'`. Build-time env vars (prefixed `NEXT_PUBLIC_`) are injected via CDK `ContainerImageBuild` build args — they cannot be changed at runtime.

Lambda@Edge function versions (`edge-function.ts`) are retained (`RemovalPolicy.RETAIN`) instead of deleted by CDK, since CloudFront replica deletion is asynchronous and premature deletion causes `DELETE_FAILED`. Retained versions accumulate over deploys and must be deleted manually (via the Lambda console/CLI, after confirming they are no longer replicated to any edge location) if cleanup is needed.

### Real-time notifications

Server → client push uses AppSync Events. Server-side: `sendEvent(channelName, payload)` with IAM SigV4 signing. Client-side: `useEventBus` hook with Cognito user pool auth. The channel namespace is `event-bus/`.

## Documentation policy

- Do not document what can be derived from code. An agent can read the codebase.
- Enforce verifiable constraints with tests and linters, not prose.
- Code comments explain "why not" only — the non-obvious reason something was done a certain way.
- Before adding a line to this file, ask: "If I remove this line, will an agent make a mistake?" If no, don't add it. If a root cause is fixed, remove the corresponding line.

## Conventions

- PR titles and code comments in English.
- Issues and discussions in English or Japanese.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
- UI components: use [shadcn/ui](https://ui.shadcn.com/). Do not introduce alternative component libraries.
- Logs: use JSON structured output.
- Dependencies: esbuild and Next.js bundle everything, so only packages with native binaries needed at Lambda runtime belong in `dependencies`. Everything else goes in `devDependencies`.
- Tests: colocate with source (`foo.test.ts` next to `foo.ts`). Use `.integ.test.ts` suffix for tests requiring external resources. Test runner is vitest for `apps/webapp` and `packages/db`; `apps/cdk` uses Jest (`test:unit`) for CDK snapshot/template tests kept under `apps/cdk/test/`.

## Contributing to the kit itself

This section applies **only if the git remote of this repository is `aws-samples/serverless-full-stack-webapp-starter-kit`**. If the remote is anything else, this project is a copy: ignore this section (and delete it, along with the `.starter-kit/` directory). From a copied app, never open issues or PRs against the upstream kit repository unless the user explicitly asks to send feedback upstream.

- Read [`.starter-kit/DESIGN_PRINCIPLES.md`](.starter-kit/DESIGN_PRINCIPLES.md) before making changes, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution workflow.
- Use [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) as the PR body structure — `gh pr create` does not apply it automatically.

## Do not

- Do not bypass `authActionClient` for any mutation. No raw Drizzle calls from Server Actions.
- Do not add an authenticated API Route without going through `withAuth()`.
- Do not add `middleware.ts`. It is deprecated in Next.js 16; route protection lives in `proxy.ts` (the renamed file convention), which runs in the Node.js Lambda runtime.
- Do not hardcode AWS region or account IDs in application code. Use CDK context or environment variables. Exception: CloudFront-adjacent resources (WAF Web ACL with `CLOUDFRONT` scope, Lambda@Edge) must be created in `us-east-1` — the dedicated `UsEast1Stack` and `EdgeFunction` construct hardcode this by design.
- Do not add `NEXT_PUBLIC_` env vars to `.env.local` for deployed builds — they must be set as CDK build args in `webapp.ts`.
- Do not use `.references()` in Drizzle schema — DSQL does not support foreign keys. Use `relations()` instead.
- Do not use `serial`, `smallserial`, or `bigserial` column types — DSQL has no sequences. Use `uuid`/`text`. (`json`/`jsonb` are supported.)
