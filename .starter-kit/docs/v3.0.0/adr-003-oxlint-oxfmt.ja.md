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

DSQL の外部キー禁止は `packages/db/src/dsql-compat.ts` が生成 DDL レイヤーで強制する — ソース構文レベルの lint を採らない理由は「結果」を参照。

### 却下した代替案

- _ESLint + Prettier（維持）_: 実行速度が遅い。ESLint のエコシステムは大きいが、キットが必要とするのはルールの小さなサブセットのみ。速度差は CI とエディタのフィードバックで体感できる。
- _Biome_: Rust ベースのリンター + フォーマッター（単一ツール）。ただし Biome は必要な粒度（モジュールからの特定の名前付き import のブロック）で `no-restricted-imports` をサポートしていない。oxlint の実装は ESLint のルールセマンティクスに一致。

## 結果

- **`no-restricted-syntax` は未対応で、ネイティブ追加予定もない。** oxlint 1.56（本キットが最初に導入したバージョン）は未知ルール名を黙って受理し、1.74 以降は `Rule 'no-restricted-syntax' not found in plugin 'eslint'` として明示的に拒否する。oxc プロジェクトは新規 Rust 製ルールを追加する予定はないと表明しており、任意 AST 制約は ESLint 互換の JavaScript プラグインで書くのが公式の道である（[oxc.rs/docs/contribute/linter/adding-rules](https://oxc.rs/docs/contribute/linter/adding-rules)）。本キットは JS プラグインを採らない — 守るべき不変条件は「DSQL に FK DDL が到達しないこと」であり、これは生成 SQL の性質であって TypeScript ソースの性質ではない（`foreignKey()` や手書き SQL も同じ禁止 DDL を生成しうる）。
- **FK 禁止の権威は DDL レイヤーに一本化する。** `packages/db/src/dsql-compat.ts` がマイグレータに渡される全ステートメントから `REFERENCES` / `FOREIGN KEY` を除去し、残っていれば拒否する。回帰保護は `packages/db/src/dsql-compat.test.ts` の `FK1`〜`FK8` で明示カバー: inline `REFERENCES` 除去（`FK1`）、`CONSTRAINT ... FOREIGN KEY` 行除去（`FK2`）、非 `CONSTRAINT` の `FOREIGN KEY` 行除去（`FK3`）、`ON DELETE` / `ON UPDATE` アクションの剥がし（`FK4`）、`validateSql` が残存 `REFERENCES` / `FOREIGN KEY` を検出（`FK5`, `FK6`）、`validateStatement` が `REFERENCES` を throw（`FK7`）、`transform → validate` 全体パスが FK-free で valid になる（`FK8`）。動作しないソース構文レベルのガードを削除することで、「黙って受理される、決して発火しないルール」による誤った安心感を排除する。
- **ルールエコシステムの縮小**: oxlint は ESLint より少ないルールをサポート。キットのニーズ（Next.js プラグイン、TypeScript、import 制限）にはカバレッジ十分。追加の ESLint ルールが必要なユーザーは oxlint と並行して ESLint を追加可能。
