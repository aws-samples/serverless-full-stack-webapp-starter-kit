# AGENTS.md

## Commands

```bash
# webapp
cd webapp && npm ci
cd webapp && npm run dev          # starts on port 3010
cd webapp && npm run build
cd webapp && npm run lint
cd webapp && npm run format

# cdk
cd cdk && npm ci
cd cdk && npm run build
cd cdk && npm test
cd cdk && npm run format
cd cdk && npx cdk deploy --all
cd cdk && npx cdk diff

# local development (requires Docker)
docker compose up -d              # PostgreSQL on port 5432
cd webapp && npx prisma db push   # sync schema to local DB
cd webapp && npm run dev
```

## Development guide

### Authentication

All server-side mutations must go through `authActionClient` (defined in `lib/safe-action.ts`). It validates the Cognito session via Amplify server-side auth and injects `ctx.userId`. Never call Prisma directly from a Server Action without this middleware.

`proxy.ts` handles route protection (redirect to `/sign-in` for unauthenticated users). It is NOT a Next.js middleware file — it runs inside the Lambda handler. There is no `middleware.ts` in this project.

### Async jobs

The dispatch flow is: Server Action → `runJob()` (Lambda async invoke) → `async-job-runner.ts` (discriminated union dispatch) → job handler → `sendEvent()` (AppSync Events) → client `useEventBus` hook.

To add a new job:
1. Add a Zod schema with a `type` literal to the discriminated union in `async-job-runner.ts`
2. Implement the handler in `src/jobs/async-job/`
3. Add the case to the switch statement

All job types share a single Lambda function via `job.Dockerfile`. The CDK `cmd` parameter selects the entry point.

### Database migration

`prisma db push` is used for schema sync by default. The migration runner Lambda is invoked automatically during `cdk deploy` via CDK Trigger. For manual invocation, use the `MigrationCommand` from CDK outputs.

Schema changes: edit `prisma/schema.prisma` → run `npx prisma db push` locally → commit. The `zod-prisma-types` generator auto-generates Zod schemas from the Prisma schema. If you switch to `prisma migrate`, update the migration runner accordingly.

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

- Do not bypass `authActionClient` for any mutation. No raw Prisma calls from Server Actions.
- Do not add `middleware.ts`. Route protection is handled by `proxy.ts` inside the Lambda runtime.
- Do not use `prisma migrate` commands unless you have explicitly switched from `prisma db push`. The default setup uses `prisma db push`.
- Do not hardcode AWS region or account IDs. Use CDK context or environment variables.
- Do not add `NEXT_PUBLIC_` env vars to `.env.local` for deployed builds — they must be set as CDK build args in `webapp.ts`.
