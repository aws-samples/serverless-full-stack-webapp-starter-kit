# Design Principles

This document is for kit maintainers. If you copied this kit to build your own app, you can safely delete the `.starter-kit/` directory.

## What this kit is

A template you **copy** (not fork) and grow into your own app. It is not a framework — users are expected to read, understand, and modify every file.

## Quality standards

As an aws-samples project, quality goals are ordered. When they conflict, the higher one wins:

1. **Security** — no secrets, credentials, or unsafe practices. A sample must never teach an insecure pattern.
2. **Correctness** — AWS APIs and framework features are used as documented. Users learn patterns from this code.
3. **Reproducibility** — following the README must produce a working deployment. `pnpm exec cdk deploy --all` must be the only deployment step, and `cdk destroy` must clean up (documented exceptions: intentionally retained resources).
4. **Readability** — code should be understandable by developers new to serverless.
5. **Simplicity** — include only what is needed to demonstrate the pattern. No production-grade defensive coding, exhaustive error handling, or speculative abstraction unless it is itself the learning target.

The litmus test for any PR: "After this merges, will a developer who copies the kit build their app on a correct understanding?"

### Review checks

In addition to the ordered goals above, reviewers verify:

- The diff is minimal — it fixes only what the linked issue describes. Unrelated improvements belong in separate PRs.
- The end-to-end guarantees stay intact: the type-safety chain (Drizzle → Zod → Server Actions → React) and the sample E2E path (auth → CRUD → async job → real-time notification).
- Sample data uses approved fictitious values (AnyCompany, example.com, 192.0.2.0/24, amzn-s3-demo-bucket).
- New dependencies are justified — prefer the standard library and already-included packages. See the dependency rules in [AGENTS.md](../AGENTS.md).
- The fix is grounded in primary sources (official docs, upstream issues), not invented when a community-agreed solution exists.

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

| Choice                                          | Rationale                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Aurora DSQL over Aurora Serverless v2           | No VPC required, true pay-per-request, IAM authentication. Eliminates NAT Instance cost and VPC complexity.                  |
| Drizzle ORM over Prisma                         | Pure TypeScript (no `prisma generate`), `relations()` naturally fits DSQL's no-FK constraint, simpler monorepo sharing.      |
| Custom migration runner over `drizzle-kit push` | DSQL requires 1 DDL per transaction. The runner splits SQL on blank lines and validates DSQL compatibility before execution. |
| Single Lambda for all async jobs                | Reduces cold starts and simplifies deployment. `cmd` parameter selects the entry point.                                      |
| `proxy.ts` over Next.js middleware              | Runs inside Lambda handler, avoiding cold-start CPU starvation from JWKS fetch in middleware.                                |
| `output: 'standalone'`                          | Required for Lambda deployment via Docker image.                                                                             |
| Lambda Web Adapter                              | Enables response streaming with CloudFront + Lambda Function URL.                                                            |
| oxlint + oxfmt over ESLint + Prettier           | Faster linting and formatting. Type-aware linting via oxlint-tsgolint replaces `tsc --noEmit`.                               |

## Major version process

Design documents and ADRs record not just decisions but **intent**. In AI-driven development, intent outlives code: when models or workflows evolve, regenerating from intent can produce better results than patching existing code. Users who "copy and grow" this kit may not copy files verbatim — they read the intent and have an AI agent re-implement it for their context.

When a major technology decision is made (e.g., ORM migration, database engine change), the following artifacts are produced. In practice the process is iterative, but the dependency direction is:

```
research → ADR → design doc → implementation plan → code → migration prompt
```

| Artifact            | Path                                        | Committed | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| research            | —                                           | No        | Technology investigation, constraint analysis, prototype validation.                                                                                                                                                                                                                                                                                                                                         |
| ADR                 | `docs/<version>/adr-NNN-<slug>[.lang].md`   | Yes       | Immutable decision records (Nygard format). What was chosen, what was rejected, and why. Must be self-contained. Once published, write a new ADR to supersede rather than editing.                                                                                                                                                                                                                           |
| design doc          | `docs/<version>/design[.lang].md`           | Yes       | Implementation specification. References ADRs for rationale; focuses on "how it works".                                                                                                                                                                                                                                                                                                                      |
| implementation plan | —                                           | No        | Task breakdown with ordering, dependencies, and verification criteria. Working document consumed during implementation and discarded after.                                                                                                                                                                                                                                                                  |
| code                | —                                           | Yes       | Implementation following the design doc.                                                                                                                                                                                                                                                                                                                                                                     |
| migration prompt    | `docs/<version>/migration-prompt[.lang].md` | Yes       | AI coding agent meta-prompt for migrating user codebases. Written last — requires knowledge that only emerges during implementation (e.g., VPC ENI cleanup timing, ESM module evaluation order). Not a step-by-step procedure for humans; the agent reads it, compares against the user's codebase, and builds a project-specific migration plan with phased execution and checkpoints to prevent data loss. |

To surface the migration guide in release notes, include a link in the `BREAKING CHANGE:` commit footer:

```
feat!: replace ORM from Prisma to Drizzle

BREAKING CHANGE: ORM has been replaced. See [migration guide](docs/v3.0.0/migration-prompt.md) for details.
```

release-please will carry this into the Breaking Changes section of the GitHub Release.

### Release notes vs. migration prompt

Release notes and the migration prompt are both published at release time, but they serve different audiences and must not be conflated:

- **Release notes** — the CHANGELOG that release-please generates from Conventional Commits, plus the GitHub Release page — are the **selective-adoption guide** for downstream owners who copied the kit. They read the release notes to decide, one change at a time, which changes to port into their own app. Therefore **one Conventional Commit = one adoption decision**. Split commits accordingly: a bug fix should not be entangled with a refactor, and an infrastructure default change and its app-side follow-up should appear as separate entries so the reader can accept or reject them independently.
- **The migration prompt** is the **whole-version-jump guide for AI agents** moving a downstream app from vN.x to v(N+1).x in one operation. It encodes knowledge that only emerges during implementation (dependency ordering, VPC ENI cleanup timing, ESM evaluation order, and similar). It is not a per-change checklist and should not be linked to as one.

Because release notes are the selective-adoption guide, every adoption decision must surface as its own entry. The branching and merge workflow exists to guarantee this:

- **Normal flow** — PRs target `main` directly and are squash-merged: one PR = one squash commit = one release-notes entry. Do not create long-lived integration branches.
- **Major-version exception** — only for large breaking work that cannot ship incrementally (a new major version), use a `dev/*` branch. Changes land on `dev/*` through squash-merged PRs as well — never direct commits — so every adoption decision keeps a reviewable anchor (PR description, review discussion, CI run, verification record).
- **Merging `dev/*` into `main`** — squash-merge the release PR, and restore per-change granularity with a `BEGIN_COMMIT_OVERRIDE` block in the PR body that enumerates the individual Conventional Commits (blank-line separated). release-please parses the block into individual CHANGELOG entries instead of the single squash commit. Reference each entry's original PR in the entry text (for historical direct commits, reference the commit instead). Caveat (observed in v3.0.0): release-please parses the block **fully for version computation but only partially for CHANGELOG generation** — long `feat!` subjects with bodies and `BREAKING CHANGE:` footers caused entries to be dropped from the generated CHANGELOG while the major bump still applied. Dry-run the exact block in a sandbox repository before merging, and diff the release PR's CHANGELOG against the block before approving it (v3.0.0 required a manual follow-up, #267).
