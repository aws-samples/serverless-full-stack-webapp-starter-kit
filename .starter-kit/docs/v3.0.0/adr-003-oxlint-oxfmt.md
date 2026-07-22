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

The DSQL foreign-key ban is enforced by `packages/db/src/dsql-compat.ts` at the generated-DDL layer — see "Consequences" for why the source-level lint approach was dropped.

### Rejected alternatives

- _ESLint + Prettier (retain)_: Execution is slow. The ESLint ecosystem is large, but the kit needs only a small subset of rules. The speed difference is perceptible in CI and editor feedback.
- _Biome_: A Rust-based linter + formatter (single tool). However, Biome does not support `no-restricted-imports` with the required granularity (blocking a specific named import from a module). oxlint's implementation matches ESLint rule semantics.

## Consequences

- **`no-restricted-syntax` is not supported and is not planned.** oxlint accepts unknown rule names silently in 1.56 (the version this kit was originally set up on), and rejects them explicitly from 1.74 onwards (`Rule 'no-restricted-syntax' not found in plugin 'eslint'`). The oxc project has stated it does not plan to add new Rust-native rules — arbitrary-AST constraints are the intended job of ESLint-compatible JavaScript plugins ([oxc.rs/docs/contribute/linter/adding-rules](https://oxc.rs/docs/contribute/linter/adding-rules)). We do not adopt a JS plugin for this: the invariant we care about is that FK DDL never reaches DSQL, and that is a property of the generated SQL, not of the TypeScript source (`foreignKey()` and hand-written SQL are equally valid ways to produce the same forbidden DDL).
- **FK ban authority lives at the DDL layer.** `packages/db/src/dsql-compat.ts` strips `REFERENCES` and `FOREIGN KEY` from every statement passed to the migrator and rejects any that still contain them. `packages/db/src/dsql-compat.test.ts` covers the regression with dedicated cases `FK1`–`FK8`: inline `REFERENCES` stripping (`FK1`), `CONSTRAINT ... FOREIGN KEY` line removal (`FK2`), non-`CONSTRAINT` `FOREIGN KEY` line removal (`FK3`), `ON DELETE` / `ON UPDATE` action stripping (`FK4`), `validateSql` catching surviving `REFERENCES` / `FOREIGN KEY` (`FK5`, `FK6`), `validateStatement` throwing on residual `REFERENCES` (`FK7`), and the end-to-end `transform → validate` pipeline yielding FK-free valid DDL (`FK8`). Removing the non-functional source-level ban avoids the false sense of safety that a silently-accepted, never-triggered rule provides.
- **Smaller rule ecosystem**: oxlint supports fewer rules than ESLint. Coverage is sufficient for the kit's needs (Next.js plugin, TypeScript, import restrictions). Users who need additional ESLint rules can add ESLint alongside oxlint.
