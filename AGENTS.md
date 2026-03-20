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
cd apps/cdk && pnpm run test
cd apps/cdk && pnpm exec cdk deploy --all
cd apps/cdk && pnpm exec cdk diff

# db migration (requires DSQL cluster)
pnpm --filter @repo/db run migrate

# lint (from root)
pnpm run lint

# local development (requires DSQL cluster)
bash scripts/dsql.sh create             # create dev DSQL cluster
cd apps/webapp && pnpm run dev
```

## Development guide

### Authentication

All server-side mutations must go through `authActionClient` (defined in `lib/safe-action.ts`). It validates the Cognito session via Amplify server-side auth and injects `ctx.userId`. Never call Drizzle directly from a Server Action without this middleware.

`proxy.ts` handles route protection (redirect to `/sign-in` for unauthenticated users). It is NOT a Next.js middleware file — it runs inside the Lambda handler. There is no `middleware.ts` in this project.

### Async jobs

The dispatch flow is: Server Action → `runJob()` (Lambda async invoke) → `apps/async-job/src/handler.ts` (discriminated union dispatch) → job handler → `sendEvent()` (AppSync Events) → client `useEventBus` hook.

To add a new job:
1. Add a Zod schema with a `type` literal to the discriminated union in `packages/shared-types/src/job-payload.ts`
2. Implement the handler in `apps/async-job/src/jobs/`
3. Add the case to the switch statement in `apps/async-job/src/handler.ts`

### Database

The project uses Aurora DSQL with Drizzle ORM. Schema is defined in `packages/db/src/schema.ts`.

DSQL constraints:
- No SERIAL/SEQUENCE — use UUID
- No FOREIGN KEY — use Drizzle `relations()` for query builder joins
- No JSON/JSONB — use TEXT
- CREATE INDEX must use ASYNC keyword
- 1 DDL per transaction

### Database migration

Migrations are SQL files in `packages/db/migrations/`. The migration runner is invoked automatically during `cdk deploy` via CDK Trigger. For manual invocation, use the `MigrationCommand` from CDK outputs.

Schema changes:

```bash
# 1. Edit schema
#    packages/db/src/schema.ts

# 2. Generate migration SQL + DSQL compatibility check
pnpm --filter @repo/db run generate

# 3. Review and fix the generated SQL in packages/db/migrations/
#    - Add IF NOT EXISTS for idempotency
#    - Replace CREATE INDEX with CREATE INDEX ASYNC
#    - Replace --> statement-breakpoint with blank lines (runner splits on \n\n)

# 4. Apply to dev cluster
pnpm --filter @repo/db run migrate

# 5. Commit schema + migration + snapshot together
```

Do not use `drizzle-kit push` or `drizzle-kit migrate` — DSQL requires 1 DDL per transaction. The custom runner (`pnpm run migrate`) handles this.

### Lambda environment

The webapp runs on Lambda behind CloudFront via Lambda Web Adapter (response streaming). `next.config.ts` uses `output: 'standalone'`. Build-time env vars (prefixed `NEXT_PUBLIC_`) are injected via CDK `ContainerImageBuild` build args — they cannot be changed at runtime.

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

## Do not

- Do not bypass `authActionClient` for any mutation. No raw Drizzle calls from Server Actions.
- Do not add `middleware.ts`. Route protection is handled by `proxy.ts` inside the Lambda runtime.
- Do not hardcode AWS region or account IDs. Use CDK context or environment variables.
- Do not add `NEXT_PUBLIC_` env vars to `.env.local` for deployed builds — they must be set as CDK build args in `webapp.ts`.
- Do not use `.references()` in Drizzle schema — DSQL does not support foreign keys. Use `relations()` instead.
- Do not use `serial`, `json`, or `jsonb` column types — DSQL does not support them.
