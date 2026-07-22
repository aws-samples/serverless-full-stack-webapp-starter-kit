# ADR-003: oxlint + oxfmt

## Status

Accepted (v3.0.0)

## Context

The kit needs lint rules that detect DSQL-incompatible patterns during coding — specifically, `no-restricted-imports`, which blocks imports of `serial` / `smallserial` / `bigserial` from `drizzle-orm/pg-core`.

The kit also assumes use with AI coding agents and recommends a post-write hook that runs lint + format after every file write (see the README "Agentic coding" section). In this workflow, it is essential that the linter and formatter run quickly enough to be imperceptible in an editor workflow.

## Decision

Replace ESLint + Prettier with oxlint + oxfmt. oxlint runs the required `no-restricted-imports` rule substantially faster than ESLint (Rust-based). oxfmt is an alternative to Prettier.

Configured DSQL-specific rules:

- `no-restricted-imports`: blocks `serial`, `smallserial`, `bigserial` from `drizzle-orm/pg-core`
- `no-restricted-syntax`: blocks `.references()` calls in schema files (configured but non-functional — see Consequences)

### Rejected alternatives

- _ESLint + Prettier (retain)_: Execution is slow. The ESLint ecosystem is large, but the kit needs only a small subset of rules. The speed difference is perceptible in CI and editor feedback.
- _Biome_: A Rust-based linter + formatter (single tool). However, Biome does not support `no-restricted-imports` with the required granularity (blocking a specific named import from a module). oxlint's implementation matches ESLint rule semantics.

## Consequences

- **`no-restricted-syntax` unsupported**: As of oxlint v1.56.0, `no-restricted-syntax` is unimplemented. The `.references()` call restriction is configured in `oxlintrc.json` but inactive. It is automatically enabled when oxlint adds support. Until then, SQL-level validation in `check-dsql-compat.ts` (detecting `REFERENCES`/`FOREIGN KEY` in generated SQL) is the fallback.
- **Smaller rule ecosystem**: oxlint supports fewer rules than ESLint. Coverage is sufficient for the kit's needs (Next.js plugin, TypeScript, import restrictions). Users who need additional ESLint rules can add ESLint alongside oxlint.
