# ADR-003: oxlint + oxfmt

## ステータス

採択（v3.0.0）

## コンテキスト

キットにはコーディング時に DSQL 非互換パターンを検出するリントルールが必要 — 具体的には `drizzle-orm/pg-core` からの `serial` / `smallserial` / `bigserial` import をブロックする `no-restricted-imports`。

また、キットは AI コーディングエージェントとの併用を前提としており、ファイル書き込みごとに lint + format を実行する post-write hook を推奨している（README「Agentic coding」セクション参照）。このワークフローでは、リンターとフォーマッターが体感できない速度で完了することが必須条件となる。

## 決定

ESLint + Prettier を oxlint + oxfmt に置き換え。oxlint は必要な `no-restricted-imports` ルールを ESLint より大幅に高速に実行（Rust ベース）。oxfmt は Prettier の代替。

設定済みの DSQL 固有ルール:

- `no-restricted-imports`: `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial` をブロック

DSQL の外部キー禁止は `packages/db/src/dsql-compat.ts` が生成後の SQL に対して強制する — 詳細は「結果」を参照。

### 却下した代替案

- _ESLint + Prettier（維持）_: 実行速度が遅い。ESLint のエコシステムは大きいが、キットが必要とするのはルールの小さなサブセットのみ。速度差は CI とエディタのフィードバックで体感できる。
- _Biome_: Rust ベースのリンター + フォーマッター（単一ツール）。ただし Biome は必要な粒度（モジュールからの特定の名前付き import のブロック）で `no-restricted-imports` をサポートしていない。oxlint の実装は ESLint のルールセマンティクスに一致。

## 結果

- **`no-restricted-syntax` は oxlint に未実装**で、追加予定もない。oxlint 1.56 は未知ルール名を黙って受理するが実行はしない。1.74 以降は `Rule 'no-restricted-syntax' not found in plugin 'eslint'` として明示的に拒否する。oxc プロジェクトは新規 Rust 製ルールを追加する予定はないと表明している（[oxc.rs/docs/contribute/linter/adding-rules](https://oxc.rs/docs/contribute/linter/adding-rules)）。Drizzle スキーマ DSL の `.references()` をブロックする目的で置いていた `**/schema.ts` override は、ESLint 互換 JS プラグインでの代替を採らず削除した。
- **FK 禁止の権威は `packages/db/src/dsql-compat.ts`（生成 SQL レイヤー）**。キットのマイグレーションパイプラインは `schema.ts` → `drizzle-kit generate` → `.sql` migration → ランナー。ADR-005 によりランナーが実行するのは `.sql`（`transformSql` + `validateStatement` を通す）と `.mjs` のみで、`.sql` は `.references()` / `foreignKey()` / 手書き SQL のいずれから生成されても必ず通る合流点になる。`transformSql` が inline `REFERENCES` / `CONSTRAINT ... FOREIGN KEY` / 単独 `FOREIGN KEY` 行を全ステートメントから除去し、`validateSql` / `validateStatement` が残存を拒否する（defence-in-depth）。回帰は `packages/db/src/dsql-compat.test.ts` の `FK1`〜`FK8` が保護する: drizzle-kit が emit しうる各 FK 形状、`ON DELETE` / `ON UPDATE` アクション、post-transform leak 検出、`transform → validate` end-to-end。
- **ルールエコシステムの縮小**: oxlint は ESLint より少ないルールをサポート。キットのニーズ（Next.js プラグイン、TypeScript、import 制限）にはカバレッジ十分。追加の ESLint ルールが必要なユーザーは oxlint と並行して ESLint を追加可能。
