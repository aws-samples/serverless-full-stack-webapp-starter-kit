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

The DSQL foreign-key ban is enforced by `packages/db/src/dsql-compat.ts` on the generated SQL — see "Consequences".

### Rejected alternatives

- _ESLint + Prettier (retain)_: Execution is slow. The ESLint ecosystem is large, but the kit needs only a small subset of rules. The speed difference is perceptible in CI and editor feedback.
- _Biome_: A Rust-based linter + formatter (single tool). However, Biome does not support `no-restricted-imports` with the required granularity (blocking a specific named import from a module). oxlint's implementation matches ESLint rule semantics.

## Consequences

- **`no-restricted-syntax` is not implemented by oxlint** and is unlikely to be added. oxlint 1.56 silently accepts the rule name but never runs it; 1.74+ rejects it explicitly with `Rule 'no-restricted-syntax' not found in plugin 'eslint'`. The oxc project has stated it does not plan to add new Rust-native rules ([oxc.rs/docs/contribute/linter/adding-rules](https://oxc.rs/docs/contribute/linter/adding-rules)). The `**/schema.ts` override that once carried this rule (intended to block `.references()` in the Drizzle schema DSL) has been removed rather than replaced with an ESLint-compatible JavaScript plugin.
- **FK-ban authority is `packages/db/src/dsql-compat.ts` on the generated SQL.** The kit's migration pipeline is `schema.ts` → `drizzle-kit generate` → `.sql` migration → runner. Under ADR-005 the runner executes only `.sql` (via `transformSql` + `validateStatement`) and `.mjs`, so the generated `.sql` is the single point every FK generation path funnels through — whether the source is `.references()`, `foreignKey()`, or hand-written SQL. `transformSql` strips inline `REFERENCES`, `CONSTRAINT ... FOREIGN KEY` clauses, and standalone `FOREIGN KEY` lines from every statement; `validateSql` / `validateStatement` reject any residue as defence-in-depth. Regression coverage lives in `packages/db/src/dsql-compat.test.ts` (`FK1`–`FK8`): each FK shape drizzle-kit can emit, the `ON DELETE` / `ON UPDATE` action variant, the post-transform leak checks, and an end-to-end `transform → validate` assertion.
- **Smaller rule ecosystem**: oxlint supports fewer rules than ESLint. Coverage is sufficient for the kit's needs (Next.js plugin, TypeScript, import restrictions). Users who need additional ESLint rules can add ESLint alongside oxlint.
