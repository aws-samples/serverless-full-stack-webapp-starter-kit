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

## Major version process

Design documents and ADRs record not just decisions but **intent**. In AI-driven development, intent outlives code: when models or workflows evolve, regenerating from intent can produce better results than patching existing code. Users who "copy and grow" this kit may not copy files verbatim — they read the intent and have an AI agent re-implement it for their context.

When a major technology decision is made (e.g., ORM migration, database engine change), the following artifacts are produced. In practice the process is iterative, but the dependency direction is:

```
research → ADR → design doc → implementation plan → code → migration prompt
```

| Artifact | Path | Committed | Description |
|----------|------|-----------|-------------|
| research | — | No | Technology investigation, constraint analysis, prototype validation. |
| ADR | `docs/<version>/adr-NNN-<slug>[.lang].md` | Yes | Immutable decision records (Nygard format). What was chosen, what was rejected, and why. Must be self-contained. Once published, write a new ADR to supersede rather than editing. |
| design doc | `docs/<version>/design[.lang].md` | Yes | Implementation specification. References ADRs for rationale; focuses on "how it works". |
| implementation plan | — | No | Task breakdown with ordering, dependencies, and verification criteria. Working document consumed during implementation and discarded after. |
| code | — | Yes | Implementation following the design doc. |
| migration prompt | `docs/<version>/migration-prompt[.lang].md` | Yes | AI coding agent meta-prompt for migrating user codebases. Written last — requires knowledge that only emerges during implementation (e.g., VPC ENI cleanup timing, ESM module evaluation order). Not a step-by-step procedure for humans; the agent reads it, compares against the user's codebase, and builds a project-specific migration plan with phased execution and checkpoints to prevent data loss. |

To surface the migration guide in release notes, include a link in the `BREAKING CHANGE:` commit footer:

```
feat!: replace ORM from Prisma to Drizzle

BREAKING CHANGE: ORM has been replaced. See [migration guide](docs/v3.0.0/migration-prompt.ja.md) for details.
```

release-please will carry this into the Breaking Changes section of the GitHub Release.
