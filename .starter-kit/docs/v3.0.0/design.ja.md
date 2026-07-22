# v3.0.0 設計ドキュメント

## 概要

v3 では DB エンジン（Aurora Serverless v2 → Aurora DSQL）、ORM（Prisma → Drizzle）、パッケージマネージャ（npm → pnpm workspaces）、リンター（ESLint + Prettier → oxlint + oxfmt）を同時に変更する。4つの変更は相互に依存しており、同時に解決することで中間状態への無駄な労力を回避する。

変更の動機、技術選定の理由、却下した代替案については ADR を参照。本ドキュメントは ADR で決定された方針の実装詳細を記述する。

- [ADR-001: Aurora DSQL + Drizzle ORM + カスタムマイグレーションランナー](adr-001-dsql-drizzle-migrator.ja.md)
- [ADR-002: pnpm workspaces モノレポ](adr-002-pnpm-workspaces.ja.md)
- [ADR-003: oxlint + oxfmt](adr-003-oxlint-oxfmt.ja.md)
- [ADR-004: DSQL admin ロールの維持](adr-004-dsql-admin-role.ja.md)
- [ADR-006: `ContainerImageBuild` によるデプロイ時イメージビルド](adr-006-deploy-time-image-build.ja.md)

## ターゲットアーキテクチャ

```
pnpm-workspace.yaml
package.json                      # ルート（scripts, devDependencies のみ）
apps/
  cdk/                            # CDK インフラ
  webapp/                         # Next.js アプリ（ジョブ・マイグレーションランナーなし）
  async-job/                      # webapp/src/jobs/ から抽出
packages/
  db/                             # Drizzle スキーマ、クライアント、マイグレーション SQL、ランナー
  shared-types/                   # ジョブペイロード型（Zod スキーマ）
```

依存関係の方向:

```
apps/webapp       → @repo/shared-types → @repo/db
apps/async-job    → @repo/shared-types → @repo/db
apps/cdk          （直接依存なし — Docker ビルドパスのみ参照）
```

アプリ同士は相互に依存しない。内部パッケージのスコープは `@repo/`。

## Aurora DSQL

### 接続パターン

DSQL は IAM 認証でのみ接続を受け付ける。`@aws/aurora-dsql-node-postgres-connector` が IAM 認証トークンの生成と node-postgres への受け渡しを自動化する。このコネクタを選択した理由:

- AWS 公式の Node.js コネクタで、IAM トークンの有効期限（15分）管理とリフレッシュを内部で処理する
- node-postgres（`pg`）の `Pool` インターフェースを拡張した `AuroraDSQLPool` を提供し、Drizzle ORM の `drizzle({ client: pool })` にそのまま渡せる
- Lambda 環境では実行ロールの IAM 認証、ローカル CLI では AWS プロファイルの認証情報を自動的に使い分ける

`@aws/aurora-dsql-postgres-js-connector`（Postgres.js 用）も存在するが、Drizzle の node-postgres ドライバとの組み合わせで `AuroraDSQLPool` を使う方がシンプル。

### DB ロールと権限モデル

DSQL は PostgreSQL のロールシステムを IAM と統合した2層の権限モデルを持つ:

- **admin ロール**（`dsql:DbConnectAdmin`）: DDL + DML + ロール管理。クラスタ作成時に自動生成される唯一の組み込みロール
- **カスタムロール**（`dsql:DbConnect`）: DML のみ。`admin` で接続して `CREATE ROLE ... WITH LOGIN` + `AWS IAM GRANT` + `GRANT ... ON ALL TABLES IN SCHEMA` で作成する

本キットでは全 Lambda（webapp、async-job、migrator）が `admin` ロールで接続する。最小権限の観点では webapp と async-job は DML のみで十分だが、CDK → マイグレーション間の順序依存（Lambda 実行ロール ARN の受け渡し）がスターターキットとしての複雑さに見合わないため `admin` を維持する。v2 でもマスターユーザーで全接続しており、v3 では IAM 一時トークンへの移行で認証レイヤーは改善済み。詳細は [ADR-004](adr-004-dsql-admin-role.ja.md) を参照。

### DDL 制約

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/ （2026-03-21 確認）

設計判断の根拠となる制約を記録する。数値的な quota（接続数、テーブル数等）は変更される可能性があるため、[公式ドキュメント](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html)を参照のこと。

#### トランザクション制約

- DDL と DML は別トランザクションが必要
- 1トランザクションに含められる DDL 文は1つのみ
- 書き込みトランザクションあたり3,000行上限（INSERT, UPDATE, DELETE すべてに適用）
- 書き込みトランザクションあたり10 MiB 上限
- トランザクション最大実行時間5分
- 分離レベルは Repeatable Read 固定
- OCC（楽観的同時実行制御）: write conflict 時に serialization error を返す。アプリ層でのリトライが必要

#### ALTER TABLE のサポート範囲

ALTER TABLE でサポートされるアクションは非常に限定的。以下が公式にサポートされる全アクション:

```sql
ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type
ALTER [ COLUMN ] column_name { SET GENERATED { ALWAYS | BY DEFAULT } | SET sequence_option | RESTART [...] }
ALTER [ COLUMN ] column_name DROP IDENTITY [ IF EXISTS ]
OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
RENAME [ COLUMN ] column_name TO new_column_name
RENAME CONSTRAINT constraint_name TO new_constraint_name
RENAME TO new_name
SET SCHEMA new_schema
```

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html

上記に含まれない操作（`DROP COLUMN`、`ALTER COLUMN TYPE`、`SET/DROP NOT NULL`、`SET/DROP DEFAULT`、`DROP CONSTRAINT`）はすべてテーブル再作成が必要。この制約がマイグレーションランナーのバリデーション対象パターンと unfixable ワークフローの設計根拠。

#### サポートされないデータ型

- `SERIAL` / `BIGSERIAL` / `SMALLSERIAL` — IDENTITY 列または UUID を使用
- 配列型（`TEXT[]` 等）— TEXT に格納（クエリランタイムでは配列型サポート）
- カスタム型 / ENUM 型
- PostGIS 等の拡張型

> `json` / `jsonb` は 2026 年に DSQL がサポートを追加したため**利用可能**（自動圧縮・1 MiB 圧縮後上限・**非インデックス**）。検索やソートのキーになる値は独立カラムへ切り出す。半構造化データには `jsonb` を推奨。

#### SEQUENCE / IDENTITY 列の制約

- `CACHE` の明示指定が必須（PostgreSQL ではオプション）
- サポートされる CACHE 値: `1` または `>= 65536` のみ（中間値は不可）
- データ型は `BIGINT` のみ
- SERIAL 型は非サポート → `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY (CACHE ...)` を使用

#### インデックス制約

- `CREATE INDEX ASYNC` 必須（同期 INDEX は不可）
- テーブルあたり最大24インデックス
- インデックスあたり最大8カラム

#### その他の DDL 制約

- FOREIGN KEY 非サポート — アプリ層で参照整合性を担保
- TRUNCATE 非サポート — `DELETE FROM` で代替
- 一時テーブル非サポート
- トリガー非サポート
- PL/pgSQL 非サポート — SQL 関数のみ
- 拡張機能非サポート（PostGIS, pgvector 等）

## カスタムマイグレーションランナー

選定理由は [ADR-001](adr-001-dsql-drizzle-migrator.ja.md) を参照。以下は実装仕様。

### 3層設計

各層は隣接する層だけに依存し、飛び越えた依存を持たない:

- **コアロジック**（`packages/db/src/migrate.ts`）: `pg.Pool` を受け取り、対象拡張子（`.sql` / `.mjs`）のファイルを名前順に適用。`.sql` は `transformSql` で DSQL 互換に変換してから空行（`\n\n`）で分割し、1文ずつ `BEGIN`/`COMMIT` で実行する（実行時変換は、生成時変換をすり抜けた手書き SQL への多層防御）。`.mjs` は `default` エクスポート関数（`async function(client)`）を呼ぶ。CDK・Lambda・Drizzle への依存なし。任意の ORM やデプロイツールで再利用可能。
- **Lambda ハンドラー**（`apps/cdk/lib/constructs/dsql-migrator/handler.ts`）: Lambda 環境変数から Pool を生成し `migrate()` を呼ぶ薄いラッパー。
- **CDK Construct**（`apps/cdk/lib/constructs/dsql-migrator/index.ts`）: `DockerImageFunction`（`ContainerImageBuild`）+ CDK Trigger で `cdk deploy` 時に自動実行。`migrations/` ディレクトリ全体の内容ハッシュを `invalidateVersionBasedOn`（Lambda 公開バージョンの無効化）と `Custom::Trigger` プロパティに注入し、マイグレーション変更時に確実に再実行させる（deploy-time build は synth 時にイメージハッシュが不定で CDK の変更検知が効かないため。詳細は [ADR-001](adr-001-dsql-drizzle-migrator.ja.md) の C1）。

この分離により、コアロジックは Drizzle 以外の ORM でも利用可能、Lambda ハンドラーは CDK 以外のデプロイツールでも利用可能、CDK Construct はマイグレーション SQL の生成方法に依存しない。

### マイグレーション状態管理

`_migrations` テーブル（name = フルファイル名, executed_at）で適用状態を管理する。`already exists` エラーは冪等性のためスキップ。1 マイグレーション = 1 ファイル 1 拡張子のため name に曖昧さはない。

内容ハッシュによる改竄検知を不採用にした理由（およびデプロイ時再実行用の `migrations/` ディレクトリハッシュとの区別）は [ADR-001 の Consequences](adr-001-dsql-drizzle-migrator.ja.md) を参照。

### SQL 自動変換

`check-dsql-compat.ts` が drizzle-kit generate の出力を DSQL 互換に自動変換する。変換ルール:

| 変換                         | 入力パターン                                                      | 出力                                                                                |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ステートメント区切り         | `--> statement-breakpoint\n`                                      | `\n\n`（空行。ランナーがこの空行で SQL を分割する）                                 |
| INDEX → ASYNC                | `CREATE INDEX` / `CREATE UNIQUE INDEX`                            | `CREATE INDEX ASYNC` / `CREATE UNIQUE INDEX ASYNC`（既に ASYNC の場合は変換しない） |
| CONSTRAINT FK 行の除去       | `,\n  CONSTRAINT "..." FOREIGN KEY (...) REFERENCES "..."("...")` | 行ごと除去（カンマも含めて削除）                                                    |
| 無名 FK 行の除去             | `,\n  FOREIGN KEY (...) REFERENCES "..."("...")`                  | 行ごと除去                                                                          |
| インライン REFERENCES の除去 | `"col" text NOT NULL REFERENCES "Table"("id")`                    | `"col" text NOT NULL`（REFERENCES 部分のみ除去し、カラム定義は保持）                |

FK 除去が2パターンに分かれる理由: drizzle-kit は FK を2通りの形式で出力する。CONSTRAINT 行（`CREATE TABLE` 末尾の独立した制約定義）とインライン REFERENCES（カラム定義の末尾に付加）。CONSTRAINT 行は行ごと除去するが、インライン REFERENCES はカラム定義を壊さないよう REFERENCES 部分のみを除去する必要がある。除去順序も重要で、CONSTRAINT 行を先に除去しないと、インライン REFERENCES の正規表現が CONSTRAINT 行内の REFERENCES にもマッチしてしまい、不完全な行が残る。

### SQL バリデーション

ランナーは各 SQL 文の実行前に DSQL 非互換パターンを検証する。検出対象:

| パターン                                                           | 理由                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `CREATE INDEX` に `ASYNC` がない                                   | DSQL は同期 INDEX を許可しない                                                     |
| `REFERENCES` / `FOREIGN KEY`                                       | DSQL は FK 非サポート                                                              |
| `ALTER COLUMN ... TYPE` / `SET DATA TYPE`                          | ALTER TABLE の公式構文に含まれない                                                 |
| `DROP COLUMN`                                                      | ALTER TABLE の公式構文に含まれない                                                 |
| `SET NOT NULL` / `DROP NOT NULL`                                   | ALTER TABLE の公式構文に含まれない                                                 |
| `SET DEFAULT` / `DROP DEFAULT`                                     | ALTER TABLE の公式構文に含まれない                                                 |
| `DROP CONSTRAINT`                                                  | ALTER TABLE の公式構文に含まれない                                                 |
| `ADD COLUMN ... DEFAULT`/`NOT NULL`/`CHECK`/`UNIQUE`/`PRIMARY KEY` | DSQL の ADD COLUMN は制約を付けられない（nullable で追加し UPDATE でバックフィル） |
| `SERIAL` / `BIGSERIAL` / `SMALLSERIAL`                             | DSQL 非サポート型                                                                  |
| `TRUNCATE`                                                         | DSQL 非サポート。`DELETE FROM` で代替                                              |

### .mjs マイグレーション

テーブル再作成（DROP COLUMN、ALTER COLUMN TYPE 等）や3,000行超のバッチデータ移行が必要な場合に使用する。`export default async function(client)` をエクスポートし、型は JSDoc（`@param {import('pg').PoolClient} client`）で補う。

`migrations/` の正準形式は `.sql` と `.mjs` の2つのみで、`.ts` は非対応。理由は local（tsx/node）と Lambda（node）が**同一ファイルを無変換で実行**するため — トランスパイル工程を挟むと local と deployed でファイルが分岐し、二重実行の温床になる（詳細は [ADR-005](adr-005-migration-file-format.ja.md)）。

制約:

- Lambda 最大実行時間は15分。これを超えるマイグレーションは Step Functions 等の別メカニズムが必要（ランナーのスコープ外）
- migrator Dockerfile は `migrations/` を生コピーする（トランスパイル工程なし）

### unfixable パターンのワークフロー

`drizzle-kit generate` が DSQL 非互換な SQL を生成した場合、`check-dsql-compat.ts` がエラーを検出し、以下の手順を案内する:

1. `git checkout -- migrations/` で生成物を元に戻す
2. `drizzle-kit generate --custom --name=<name>` で空のマイグレーションファイル + 更新されたスナップショットを生成
3. `.sql`（3,000行以下）または `.mjs`（バッチ移行）でテーブル再作成を記述
4. `pnpm --filter @repo/db run migrate` で適用

エラー時に自動ロールバックしない理由は [ADR-001 の Consequences](adr-001-dsql-drizzle-migrator.ja.md) を参照。

### マイグレーション整合性の CI 検証

CI（`check:ci`）で2種類の整合性を検証する:

- **チェーン整合**: `drizzle-kit check`（`check:migrations`）が snapshot チェーンのフォーク（重複 `prevId`）や `schema.ts` との乖離を検出する。
- **generate ドリフト**: `generate` を実行して `migrations/` に差分が出れば失敗させる（`schema.ts` を変更したのに未 generate のケースを検出）。`generate` は DB 接続不要かつ非対話で実行する（stdin を閉じ、rename プロンプトで CI がハングするのを防ぐ）。

## DSQL 互換性戦略

DSQL 非互換パターンをコーディング時とマイグレーション時の2段階で検出する。

**第1層 — oxlint（スキーマ定義レベル）**: `no-restricted-imports` で `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial` の import をブロック（`json`/`jsonb` は DSQL がサポートしたため許可）。エディタと CI で即座にフィードバック。（`.references()` 用の `no-restricted-syntax` は設定済みだが oxlint v1.56.0 時点で未動作。詳細は [ADR-003](adr-003-oxlint-oxfmt.ja.md) を参照。）

**第2層 — SQL バリデーション（生成 SQL レベル）**: `check-dsql-compat.ts` が drizzle-kit 出力を自動変換し、自動修正不可能なパターンを検証。

2層に分ける理由: oxlint で検出できるものは oxlint に任せ、SQL 正規表現は「TypeScript の世界では検出できない、生成 SQL レベルの問題」に限定する。`notNull()` や `default()` の追加・削除は lint では禁止しない — 新規カラムでの正当な使用と、既存カラムの非互換な変更を区別できないため。これらは生成 SQL レベル（`SET NOT NULL`、`DROP DEFAULT` 等）で検出する。

## pnpm workspaces + Docker ビルド

選定理由は [ADR-002](adr-002-pnpm-workspaces.ja.md) を参照。以下は実装上の制約と対処。

### ContainerImageBuild によるリモートビルド

全コンテナイメージ（webapp、async-job、dsql-migrator）を `@cdklabs/deploy-time-build` の `ContainerImageBuild` でビルドする。`DockerImageCode.fromImageAsset`（ローカル Docker ビルド）は使用しない。

動機: デプロイ時のローカル Docker 依存を排除する。Windows での Docker Desktop セットアップや CI 環境での Docker-in-Docker が不要になり、Prerequisites から Docker を削除できる。

仕組み: `cdk deploy` 時に CloudFormation カスタムリソースが CodeBuild（ARM/Small）でイメージをビルドし ECR にプッシュする。同一スタック・同一アーキテクチャの `ContainerImageBuild` は `SingletonProject` により1つの CodeBuild プロジェクトを共有する。

トレードオフ:

- Docker レイヤーキャッシュが効かない（毎回フルビルド）
- CodeBuild ARM/Small の同時実行クォータがデフォルト1のため、複数ビルドはキューイングされ直列実行になる。Service Quotas で引き上げ可能

### スクリプト規約

各サブパッケージが定型タスク名（`dev`、`build`、`test:unit`、`lint`、`check:ci` 等）を自身の `package.json` に定義し、ルートからは `pnpm -r run <task>` で一括実行する。ルート `package.json` にはタスクのエイリアススクリプトを置かない — 各パッケージが自身のスクリプトを持つため冗長であり、`--if-present` 付きの間接呼び出しはデバッグを困難にする。

pre-commit フックは `simple-git-hooks` + `lint-staged` で構成し、ステージ済みファイルに oxlint/oxfmt を実行した後、全パッケージの `test:unit` を実行する。`prepare` スクリプトにより `pnpm install` 時にフックが自動インストールされる。lint-staged の oxlint 呼び出しでは `typeCheck` による型チェックが効かない — lint-staged はステージ済みファイルのみを引数に渡すため、プロジェクト全体の tsconfig 解決が必要な型チェックと非互換。型チェックは CI の `check:ci`（`oxlintrc.json` の `typeCheck: true`）で担保する。

### Docker ビルドの制約

strict モードでの Docker ビルドには4つの罠がある（詳細は [ADR-002 の Consequences](adr-002-pnpm-workspaces.ja.md) を参照）:

1. `pnpm install --filter` は推移的依存をホイストしない → `--filter` なしで全依存インストール
2. CDK `DockerImageCode.fromImageAsset` は `.dockerignore` を読まない → `ignoreMode: IgnoreMode.DOCKER` 必須
3. esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要
4. `--external:@aws-sdk/*` は `@aws/*` パッケージを除外しない

## ESM 即時評価と Proxy 遅延初期化

`client.ts` は Proxy ベースの遅延初期化と `globalThis` シングルトンを組み合わせて、2つの問題を解決する。

1. **ESM 即時評価の回避（Proxy）**: ESM ではトップレベルの `export const db = drizzle(...)` がモジュール import 時に即座に評価される。`cli.ts` が `import { getPool } from './client'` しただけで `db` の初期化も走り、`DSQL_ENDPOINT` 未設定時にクラッシュする。Proxy を使うことで、`import { db }` の既存コードを変更せずに、実際のプロパティアクセス時まで初期化を遅延させる。関数でラップする方式（`getDb()`）も検討したが、全ての呼び出し箇所の変更が必要になるため不採用。
2. **Next.js hot-reload でのコネクションリーク防止（`globalThis`）**: Next.js の dev server はモジュールを再評価するため、`globalThis` にインスタンスを保持しないと reload のたびに新しいコネクションプールが作られリークする。Proxy の遅延初期化先を `globalThis` 上のシングルトンにすることで両方を同時に解決。

## テスト設計

マイグレーションランナーと DSQL 互換性チェックのテストは、フィクスチャベースの2層構造で設計した。

### フィクスチャベーステスト

SQL 文字列の正規表現操作は偽陽性（正常な SQL をエラーにする）と偽陰性（非互換 SQL を見逃す）のリスクがある。入力は「drizzle-kit generate の出力」に限定されるため、実際の出力をフィクスチャとして使用する。各フィクスチャは `input.sql` / `expected.sql` のペアで、変換の入出力を明示的に検証する。

### unit / integration の分離

- **unit テスト**: `pg.Pool` をモックし、ファイルシステムもモック。DB 不要で即座に実行可能。変換ロジックとバリデーションの網羅的なパターンカバレッジを担保
- **integration テスト**: 実 DSQL クラスタに対して実行。変換後の SQL が実際に DSQL で動作することの証明、冪等性の検証、`already exists` スキップの実動作確認を担当。`DSQL_ENDPOINT` 環境変数が設定されている場合のみ実行

この分離により、CI では unit テストのみで高速にフィードバックし、DSQL クラスタが必要な integration テストは開発者のローカル環境で実行する。

### integration テストの分離戦略

integration テストは本番の `migrations/` ディレクトリを汚染しないよう、`os.tmpdir()` 配下に一時 migrations ディレクトリを作成してテスト用 SQL を配置する。各テストの前に `DROP TABLE IF EXISTS` で対象テーブルと `_migrations` テーブルをクリーンアップし、テスト間の状態依存を排除する。

この方式を選択した理由: テスト用 DB スキーマを使う方式（`SET search_path`）は DSQL のスキーマ数上限（10個）に抵触するリスクがある。トランザクションロールバック方式は DDL がトランザクション内で動作しない DSQL では使えない。テーブル DROP + 一時ディレクトリが最もシンプルで DSQL の制約と衝突しない。
