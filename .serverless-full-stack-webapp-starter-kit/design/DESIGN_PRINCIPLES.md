# Design Principles

This document is for kit maintainers. If you copied this kit to build your own app, you can safely delete the `.serverless-full-stack-webapp-starter-kit/` directory.

## What this kit is

A template you **copy** (not fork) and grow into your own app. It is not a framework — users are expected to read, understand, and modify every file.

## Quality standards

As an aws-samples project:

- Correctness is the top priority — users learn patterns from this code.
- Reproducibility — following the README must produce a working deployment.
- Readability — code should be understandable by developers new to serverless.
- One-command deploy — `npx cdk deploy --all` must be the only deployment step.

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
| `prisma db push` over `prisma migrate` | Simpler default for starter-kit scope. Users can switch to `prisma migrate` when they need migration history. |
| NAT Instance over NAT Gateway | ~$30/month savings. Acceptable trade-off for a starter kit. |
| Single Lambda for all async jobs | Reduces cold starts and simplifies deployment. `cmd` parameter selects the entry point. |
| `proxy.ts` over Next.js middleware | Runs inside Lambda handler, avoiding cold-start CPU starvation from JWKS fetch in middleware. |
| `output: 'standalone'` | Required for Lambda deployment via Docker image. |
| Lambda Web Adapter | Enables response streaming with CloudFront + Lambda Function URL. |

### Architecture Decision Records (ADR)

ADRs are not used yet. Introduce `design/adr/` when a major technology decision is made (e.g., ORM migration, database engine change) that requires recording the context, alternatives considered, and rationale.
