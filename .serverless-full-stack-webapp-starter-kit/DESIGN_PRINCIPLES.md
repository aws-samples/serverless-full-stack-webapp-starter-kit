# Design Principles

This document is for kit maintainers. If you copied this kit to build your own app, you can safely delete the `.serverless-full-stack-webapp-starter-kit/` directory.

## What this kit is

A template you **copy** (not fork) and grow into your own app. It is not a framework — users are expected to read, understand, and modify every file.

## Quality standards

As an aws-samples project:

- Correctness is the top priority — users learn patterns from this code.
- Reproducibility — following the README must produce a working deployment.
- Readability — code should be understandable by developers new to serverless.
- One-command deploy — `pnpm exec cdk deploy --all` must be the only deployment step.

The litmus test for any PR: "After this merges, will a developer who copies the kit build their app on a correct understanding?"

## Design decisions

### Template, not framework

- Breaking changes have low impact — users copy and diverge. Major versions can be bumped without a lengthy deprecation cycle.
- The sample app exists solely to prove all kit components work together. Users will delete it. Do not expand sample app features beyond what is needed for this proof.
- Avoid over-abstraction. Readability and modifiability matter more than DRY.

### What to include

- Patterns that every serverless full-stack webapp needs (auth, DB, async jobs, real-time).
- Operational essentials (migration, logging, cost-optimized defaults).
- Only what cannot be trivially added later.

### What to exclude

- App-specific business logic.
- Dependencies on specific AI models or services.
- Patterns needed by fewer than half of expected users.

### Technology choices

| Choice | Rationale |
|--------|-----------|
| Aurora DSQL over Aurora Serverless v2 | No VPC required, true pay-per-request, IAM authentication. Eliminates NAT Instance cost and VPC complexity. |
| Drizzle ORM over Prisma | Pure TypeScript (no `prisma generate`), `relations()` naturally fits DSQL's no-FK constraint, simpler monorepo sharing. |
| Custom migration runner over `drizzle-kit push` | DSQL requires 1 DDL per transaction. The runner splits SQL on blank lines and validates DSQL compatibility before execution. |
| Single Lambda for all async jobs | Reduces cold starts and simplifies deployment. `cmd` parameter selects the entry point. |
| `proxy.ts` over Next.js middleware | Runs inside Lambda handler, avoiding cold-start CPU starvation from JWKS fetch in middleware. |
| `output: 'standalone'` | Required for Lambda deployment via Docker image. |
| Lambda Web Adapter | Enables response streaming with CloudFront + Lambda Function URL. |
| oxlint + oxfmt over ESLint + Prettier | Faster linting and formatting. Type-aware linting via oxlint-tsgolint replaces `tsc --noEmit`. |

### Architecture Decision Records (ADR)

Design documents and ADRs record not just decisions but **intent** — the reasoning, constraints, and trade-offs behind a design. In AI-driven development, intent outlives code: when models or workflows evolve, regenerating from intent can produce better results than patching existing code. Users who "copy and grow" this kit may not copy files verbatim — they read the intent and have an AI agent re-implement it for their context.

ADRs use the Nygard format (Status → Context → Decision → Consequences) with rejected alternatives in the Decision section. Place them in `docs/<version>/adr.md` alongside the design document for that version.

When a major technology decision is made (e.g., ORM migration, database engine change), create:
- `docs/<version>/design.md` — motivation, target architecture, key design decisions
- `docs/<version>/adr.md` — formal decision records with alternatives and consequences

### Migration guides

When a breaking change is introduced, write a migration guide alongside the ADR. Place it in `docs/<version>/migration-prompt.md`.

A migration guide is not a step-by-step procedure for humans. It is a meta-prompt for an AI coding agent — the agent reads it, compares against the user's codebase, and builds a project-specific migration plan. Write it with that consumer in mind: describe what changed, why, what patterns in user code are affected, and provide phased execution with checkpoints to prevent data loss.

To surface the guide in release notes, include a link in the `BREAKING CHANGE:` commit footer:

```
feat!: replace ORM from Prisma to Drizzle

BREAKING CHANGE: ORM has been replaced. See [migration guide](docs/v3.0.0/migration-prompt.md) for details.
```

release-please will carry this into the Breaking Changes section of the GitHub Release.
