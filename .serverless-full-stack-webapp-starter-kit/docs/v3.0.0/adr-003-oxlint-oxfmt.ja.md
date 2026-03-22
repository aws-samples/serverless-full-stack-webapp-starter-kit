# ADR-003: oxlint + oxfmt

## ステータス

採択（v3.0.0）

## コンテキスト

キットにはコーディング時に DSQL 非互換パターンを検出するリントルールが必要 — 具体的には `drizzle-orm/pg-core` からの `serial`, `json`, `jsonb` import をブロックする `no-restricted-imports`。リンター速度は開発者体験と CI 時間に影響し、モノレポの成長に伴い重要性が増す。

## 決定

ESLint + Prettier を oxlint + oxfmt に置き換え。oxlint は必要な `no-restricted-imports` ルールを ESLint より大幅に高速に実行（Rust ベース）。oxfmt は Prettier の代替。

設定済みの DSQL 固有ルール:
- `no-restricted-imports`: `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial`, `json`, `jsonb` をブロック
- `no-restricted-syntax`: スキーマファイルでの `.references()` 呼び出しをブロック（設定済みだが未動作 — 結果を参照）

### 却下した代替案

- *ESLint + Prettier（維持）*: 実行速度が遅い。ESLint のエコシステムは大きいが、キットが必要とするのはルールの小さなサブセットのみ。速度差は CI とエディタのフィードバックで体感できる。
- *Biome*: Rust ベースのリンター + フォーマッター（単一ツール）。ただし Biome は必要な粒度（モジュールからの特定の名前付き import のブロック）で `no-restricted-imports` をサポートしていない。oxlint の実装は ESLint のルールセマンティクスに一致。

## 結果

- **`no-restricted-syntax` 未サポート**: oxlint v1.56.0 時点で `no-restricted-syntax` は未実装。`.references()` 呼び出し制限は `oxlintrc.json` に設定済みだが無効。oxlint がサポートを追加した時点で自動的に有効化される。それまでは `check-dsql-compat.ts` の SQL レベルバリデーション（生成 SQL 内の `REFERENCES`/`FOREIGN KEY` 検出）がフォールバック。
- **ルールエコシステムの縮小**: oxlint は ESLint より少ないルールをサポート。キットのニーズ（Next.js プラグイン、TypeScript、import 制限）にはカバレッジ十分。追加の ESLint ルールが必要なユーザーは oxlint と並行して ESLint を追加可能。
