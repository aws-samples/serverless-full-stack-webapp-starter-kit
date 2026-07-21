<!--
Before writing code, verify the issue against the current code and ground your
fix in primary sources. See CONTRIBUTING.md and .starter-kit/DESIGN_PRINCIPLES.md.
PR title must follow Conventional Commits (enforced by CI).
-->

## Issue

Closes #

## Problem

<!-- What is wrong today? Include references to primary sources (official docs, upstream issues) that ground your analysis. -->

## Solution

<!-- What you changed and why this approach. Prefer community-agreed solutions over inventing new ones. -->

## Changes

<!-- Bullet list of changed files / behavior. -->

## Verification

<!-- How you verified: commands run, tests added or updated, deploy tested. -->

## Checklist

- [ ] I have read [`.starter-kit/DESIGN_PRINCIPLES.md`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/blob/main/.starter-kit/DESIGN_PRINCIPLES.md)
- [ ] The diff is minimal — only what the linked issue describes
- [ ] One-command deploy is preserved (`pnpm exec cdk deploy --all` remains the only deployment step)
- [ ] The type-safety chain (Drizzle → Zod → Server Actions → React) is intact
- [ ] Sample data uses fictitious values (AnyCompany, example.com, 192.0.2.0/24, amzn-s3-demo-bucket)
- [ ] Lint, build, and tests pass locally (commands in [`AGENTS.md`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/blob/main/AGENTS.md))

<!-- Litmus test: after this merges, will a developer who copies the kit build their app on a correct understanding? -->
