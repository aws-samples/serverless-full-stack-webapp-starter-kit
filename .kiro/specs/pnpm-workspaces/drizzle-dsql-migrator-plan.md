# Drizzle-DSQL Migrator: 仕様整理とテスト計画

## Phase 1: DSQL仕様・制約と導出される要求機能

### 1. Aurora DSQLのDDL制約（公式ドキュメント準拠）

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/ （2026-03-21確認）

#### 1.1 トランザクション制約

| 制約 | 内容 | 出典 |
|------|------|------|
| DDLとDMLは別トランザクション | DDLとDML操作は別トランザクションが必要 | migration-guide#considerations |
| 1トランザクション1DDL | 1トランザクションに含められるDDL文は1つのみ | migration-guide#considerations |
| 3,000行/トランザクション上限 | INSERT, UPDATE, DELETE すべてに適用 | CHAP_quotas |
| 10 MiB/writeトランザクション上限 | 書き込みトランザクションのデータサイズ上限 | CHAP_quotas |
| 5分/トランザクション上限 | トランザクション最大実行時間 | CHAP_quotas |
| Repeatable Read固定 | トランザクション分離レベルは変更不可 | migration-guide#considerations |
| OCC (楽観的同時実行制御) | write conflict時にserialization errorを返す。リトライロジックが必要 | migration-guide#modern-application-patterns |

#### 1.2 ALTER TABLE — サポートされるアクション（公式構文）

ALTER TABLEのサポート範囲は**非常に限定的**。以下が公式にサポートされる全アクション:

```sql
-- サポートされるアクション
ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type
ALTER [ COLUMN ] column_name { SET GENERATED { ALWAYS | BY DEFAULT } | SET sequence_option | RESTART [...] } [...]
ALTER [ COLUMN ] column_name DROP IDENTITY [ IF EXISTS ]
OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }

-- サポートされるRENAME/SET SCHEMA
RENAME [ COLUMN ] column_name TO new_column_name
RENAME CONSTRAINT constraint_name TO new_constraint_name
RENAME TO new_name
SET SCHEMA new_schema
```

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html

**サポートされないALTER TABLE操作（公式構文に含まれないもの）:**
- `DROP COLUMN` — テーブル再作成が必要
- `ALTER COLUMN ... TYPE` / `SET DATA TYPE` — テーブル再作成が必要
- `ALTER COLUMN ... SET NOT NULL` / `DROP NOT NULL` — テーブル再作成が必要
- `ALTER COLUMN ... SET DEFAULT` / `DROP DEFAULT` — テーブル再作成が必要
- `ADD CONSTRAINT` (FOREIGN KEY) — FK非サポート
- `DROP CONSTRAINT` — テーブル再作成が必要

#### 1.3 サポートされるデータ型

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-data-types.html

**数値型:** smallint, integer, bigint, real, double precision, numeric/decimal (精度最大38, スケール最大37)
**文字型:** char(n) (最大4096B), varchar(n) (最大65535B), bpchar(n), text (最大1MiB)
**日時型:** date, time, timetz, timestamp, timestamptz, interval
**その他:** boolean, bytea (最大1MiB), uuid

**サポートされない型（ストレージ型として）:**
- `json` / `jsonb` — TEXTに格納し、クエリ時にキャストして使用（JSON runtime functionsはサポート）
- `SERIAL` / `BIGSERIAL` / `SMALLSERIAL` — IDENTITY列またはUUIDを使用
- 配列型（TEXT[]等） — TEXTに格納（クエリランタイムでは配列型サポート）
- カスタム型 / ENUM型
- PostGIS等の拡張型

**2026年2月の新機能:**
- NUMERIC型のインデックスサポート追加（What's New 2026-02-03）
- IDENTITY列とSEQUENCEオブジェクトのサポート追加（What's New 2026-02-13）

#### 1.4 SEQUENCE / IDENTITY列の制約

出典: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-sequence-syntax-support.html

- `CACHE` の明示指定が**必須**（PostgreSQLではオプション、デフォルト1）
- サポートされるCACHE値: `1` または `>= 65536` のみ（中間値は不可）
- データ型は `BIGINT` のみ
- SERIAL型は非サポート → `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY (CACHE ...)` を使用
- シーケンス最大数: 5,000/データベース

#### 1.5 インデックス制約

- `CREATE INDEX ASYNC` 必須（同期INDEXは不可）
- テーブルあたり最大24インデックス
- インデックスあたり最大8カラム
- PK/セカンダリインデックスのキーサイズ最大1KiB

#### 1.6 その他のDDL制約

| 制約 | 内容 |
|------|------|
| FOREIGN KEY非サポート | アプリ層で参照整合性を担保 |
| TRUNCATE非サポート | `DELETE FROM table_name` で代替 |
| 一時テーブル非サポート | CTE/サブクエリまたは通常テーブルで代替 |
| トリガー非サポート | アプリ層で実装 |
| PL/pgSQL非サポート | SQL関数のみ。複雑なロジックはアプリ層/Lambda |
| 拡張機能非サポート | PostGIS, pgvector等 |
| パーティショニング非サポート | 自動分散 |
| 単一データベース | クラスタあたり1つの `postgres` DB |
| スキーマ最大10個 | データベースあたり |
| テーブル最大1,000個 | データベースあたり |

#### 1.7 接続制約

| 制約 | 値 |
|------|-----|
| IAM認証トークン有効期限 | 15分 |
| 最大接続時間 | 60分 |
| クラスタあたり最大接続数 | 10,000 |
| 接続レート | 100接続/秒（バースト1,000） |
| SSL | 必須（verify-full推奨） |
| コレーション | C のみ |
| エンコーディング | UTF-8 |
| タイムゾーン | UTC（クライアント側で変換可能） |

#### 1.8 ORM/マイグレーションツールの公式サポート状況（2026-02時点）

出典: What's New 2026-02-25

- **Prisma**: CLI tools（スキーマ検証 + DSQL互換マイグレーション生成）
- **Flyway**: DSQL dialect（IAM認証 + DSQL固有動作の自動処理）
- **Tortoise ORM** (Python): adapter
- **Drizzle ORM**: 公式サポートなし（drizzle-team/drizzle-orm#5248 open）。node-postgres経由で動作

**Node.js Connector:**
- `@aws/aurora-dsql-node-postgres-connector` — node-postgres用（IAM認証自動化）
- `@aws/aurora-dsql-postgres-js-connector` — Postgres.js用（WebSocketサポート含む）

### 2. drizzle-kit migrate / push が使えない理由

- `drizzle-kit migrate`: 全未適用マイグレーションを**1トランザクション**で実行する（dialect.tsのソースコード確認済み）。DSQLの1DDL/トランザクション制約と根本的に衝突
- `drizzle-kit push`: DSQLの制約を考慮しないDDLを直接実行するため、同様に衝突
- Drizzle ORMのDSQL正式サポートは未リリース（drizzle-team/drizzle-orm#5248）

### 3. 採用アプローチ: drizzle-kit generate + 自前ランナー

Drizzle公式ドキュメントの「Option 5」（生成だけして適用は外部ツール）に該当。Vercel公式デモ（aws-dsql-movies-demo）と同じアプローチ。

### 4. migratorに求められる機能一覧

#### 4.1 SQL変換（check-dsql-compat / transform）

drizzle-kit generateの出力SQLをDSQL互換に自動変換する。

| 変換 | 入力 | 出力 |
|------|------|------|
| ステートメント区切り | `--> statement-breakpoint` | 空行（`\n\n`）に置換 |
| INDEX → ASYNC | `CREATE INDEX` | `CREATE INDEX ASYNC` |
| UNIQUE INDEX → ASYNC | `CREATE UNIQUE INDEX` | `CREATE UNIQUE INDEX ASYNC` |
| FK除去 | `REFERENCES ...` / `FOREIGN KEY ...` を含む文 | 除去 |

#### 4.2 SQLバリデーション（check-dsql-compat / validate）

自動変換できないDSQL非互換パターンを検出してエラーにする。

##### バリデーション設計の判断

DSQL非互換パターンの検出は2層で行う:

1. **TypeScript AST（oxlint）**: スキーマ定義（schema.ts）で検出可能なパターン。コーディング時にエディタ/CIで即座にフィードバック。`serial/json/jsonb` のimport禁止、`.references()` の呼び出し禁止
2. **SQL正規表現（check-dsql-compat / validateStatement）**: drizzle-kit generateの出力SQLに対する検出。AST が使えない場面の最終手段

oxlintで検出できるものはoxlintに任せる。SQL正規表現は「TypeScriptの世界では検出できない、生成SQLレベルの問題」に限定する。`notNull()` や `default()` の追加/削除は正当な使用（新規カラム）と非互換な変更（既存カラム）を区別できないため、lintでは禁止せず、生成SQLレベルで検出する。

ALTER TABLEの公式サポート範囲が非常に限定的であるため（ADD COLUMN, RENAME, identity操作, OWNER TO, SET SCHEMAのみ）、drizzle-kit generateが出力しうる以下のパターンを検出する:

| 検出パターン | 理由 |
|-------------|------|
| `ALTER COLUMN ... TYPE` / `SET DATA TYPE` | ALTER TABLEの公式構文に含まれない |
| `DROP COLUMN` | ALTER TABLEの公式構文に含まれない |
| `SET NOT NULL` / `DROP NOT NULL` | ALTER TABLEの公式構文に含まれない |
| `SET DEFAULT` / `DROP DEFAULT` | ALTER TABLEの公式構文に含まれない |
| `DROP CONSTRAINT` | ALTER TABLEの公式構文に含まれない |
| `SERIAL` / `BIGSERIAL` / `SMALLSERIAL` | DSQL非サポート型。IDENTITY列を使用 |
| `TRUNCATE` | DSQL非サポート。DELETE FROMで代替 |
| `CREATE INDEX` に `ASYNC` がない（変換後の最終チェック） | DSQL必須 |
| `REFERENCES` / `FOREIGN KEY`（変換後の最終チェック） | DSQL非サポート |

#### 4.3 マイグレーションランナー（migrate.ts）

Vercelデモを参考に、以下の改善を加える:

1. `_migrations` テーブルで適用状態を管理（name, executed_at）
2. `migrations/` ディレクトリから `.sql` および `.ts` ファイルをソート順に読み込み
3. `.sql` ファイル: 空行（`\n\n`）で分割し、1文ずつ BEGIN/COMMIT で実行
4. `.ts` ファイル: `export default async function(client: ClientBase)` を動的importして実行。バッチデータ移行等、SQLだけでは対応できないケースに使用
5. `already exists` エラーは冪等性のためスキップ（Vercelデモと同じ）
6. `pg.Pool` を受け取る環境非依存設計（Lambda / CLI 両対応）

hash検証は採用しない。適用済みファイルをフォーマッター/エディタが整形した場合にバイト列が変わり、ロジック無変更でもhash不一致エラーになる。適用済みファイルの改竄防止はgit管理で十分。

##### .ts マイグレーションの用途と制約

テーブル再作成（DROP COLUMN, ALTER COLUMN TYPE等）で3,000行超のバッチデータ移行が必要な場合に使用する。

制約:
- Lambda最大実行時間は15分。これを超えるマイグレーションは実行できない。15分を超える場合はStep Functions等の別メカニズムが必要（migratorのスコープ外）
- Lambda環境では `.ts` ファイルは事前トランスパイルが必要（Dockerfile内でesbuildで `.mjs` に変換）
- CLI環境では `tsx` が `.ts` を直接実行可能

##### テーブル再作成が必要な変更のワークフロー

drizzle-kit generateがDSQL非互換なSQLを生成した場合:

1. `check-dsql-compat.ts` がエラーを検出し、対処法を案内
2. エラーメッセージ:
   ```
   ERROR: DROP COLUMN is not supported by DSQL. Table recreation required.
   Steps:
     1. Run: git checkout -- migrations/
     2. Run: pnpm --filter @repo/db exec drizzle-kit generate --custom --name=<migration-name>
     3. Write table recreation SQL/TS in the generated file
     4. Run: pnpm --filter @repo/db run migrate
   ```
3. ユーザーが `git checkout -- migrations/` で生成物を元に戻す
4. ユーザーが `drizzle-kit generate --custom` を実行 → 空のマイグレーションファイル + スナップショットが schema.ts の現在の状態に更新される
5. ユーザーが `.sql`（3,000行以下）または `.ts`（3,000行超のバッチ移行）でテーブル再作成を記述
6. `pnpm run migrate` で適用

#### 4.4 oxlint ルール（スキーマ定義レベルの早期検出）

`no-restricted-imports` と `no-restricted-syntax` で検知:

| ルール | 対象 | 状態 |
|--------|------|------|
| `no-restricted-imports` | `drizzle-orm/pg-core` から `serial`, `smallserial`, `bigserial`, `json`, `jsonb` のimportを禁止 | ✅ 動作確認済み |
| `no-restricted-syntax` | `.references()` メソッド呼び出しを禁止（スキーマファイル限定） | ⚠️ oxlint v1.56.0 時点で未サポート |

**制約: `no-restricted-syntax` は oxlint v1.56.0 時点で未実装ルール。** oxlintrc.json に設定は記述済みだが、実行時に無視される。oxlint が同ルールをサポートした時点で自動的に有効化される。それまでの間、`.references()` の検出は check-dsql-compat.ts の SQL バリデーション（REFERENCES / FOREIGN KEY 検出）が最終防衛線となる。

#### 4.5 CLI（cli.ts）

- `pnpm --filter @repo/db run migrate` でローカル実行可能
- AWS プロファイルのIAM認証情報を使用
- `DSQL_ENDPOINT` と `AWS_REGION` を環境変数から読み込み
- `.env` ファイルのサポート（`tsx --env-file=.env`）

#### 4.6 Lambda ハンドラー

- CDK Trigger で `cdk deploy` 時に自動実行
- Lambda実行ロールのIAM認証を使用
- コアロジック（migrate.ts）の薄いラッパー
- 冪等（再実行で既適用マイグレーションをスキップ）
- `.ts` マイグレーションは Dockerfile 内で事前トランスパイル（esbuild → `.mjs`）
- Lambda最大実行時間15分の制約あり。これを超えるマイグレーションは実行不可
- CDK Construct: `memorySize: 2048`（データ移行時のメモリ確保）、`timeout: Duration.minutes(15)`

#### 4.7 drizzle-kit generate のラッパー（package.json scripts）

`pnpm --filter @repo/db run generate` で:
1. `drizzle-kit generate` を実行
2. 生成されたSQLに対して自動変換（statement-breakpoint → 空行、INDEX → ASYNC、FK除去）
3. 自動変換できないパターンがあればエラー + 対処法を案内

エラー時のロールバックは行わない（drizzle-kitの内部フォーマットへの依存を避ける）。ユーザーは `git checkout -- migrations/` で生成物を元に戻す。エラーメッセージにこの手順を含める。

### 5. 計画書から導出された追加要求（元の要求に不足していたもの）

1. ~~**hash検証**~~: 不採用。フォーマッター/エディタによる意図しないバイト列変更で誤検知する。適用済みファイルの改竄防止はgit管理で十分
2. **OCC リトライ**: DSQLのOptimistic Concurrency Controlによるserialization error時のリトライ。DDL実行時の concurrent DDL operation エラーへの対応
3. **TRUNCATE検出**: DSQLはTRUNCATEをサポートしない。バリデーションで検出が必要
4. ~~**配列型検出**~~: Drizzleのpg-coreに配列型のAPIが存在しないため、ユーザーが `sql` テンプレートリテラルで直接書かない限り発生しない。検出不要
5. **IDENTITY列のサポート**: SERIAL非サポートの代替として、`GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY` をサポート。CACHE指定は必須で、値は `1` または `>= 65536` のみ
6. **ESM即時評価の回避**: `client.ts` の `db` 初期化がモジュール読み込み時に走る問題。Proxy遅延初期化が必要（plan.mdの「実装後の検証で発見した問題」セクション）
7. **接続パターン**: `@aws/aurora-dsql-node-postgres-connector` を使用したIAM認証接続。Lambda環境とローカルCLI環境の両方に対応
8. **ALTER TABLE制約の正確な把握**: 公式ドキュメントによると、ALTER TABLEでサポートされるアクションは `ADD COLUMN`, `RENAME COLUMN/TABLE/CONSTRAINT`, `SET SCHEMA`, `OWNER TO`, identity列操作のみ。`SET NOT NULL`, `DROP NOT NULL`, `SET DEFAULT`, `DROP DEFAULT`, `DROP CONSTRAINT` も非サポートであり、バリデーションで検出が必要
9. **NUMERIC型インデックス**: 2026-02-03にNUMERIC型のインデックスサポートが追加。サポートされるデータ型の認識を更新

### 6. 参考実装との差分

| 機能 | Vercelデモ | 本migrator |
|------|-----------|-----------|
| マイグレーション管理テーブル | `migrations` (id, name, executed_at) | `_migrations` (name, executed_at) |
| hash検証 | なし | なし（フォーマッター/エディタによる意図しない変更で誤検知するため不採用。git管理で十分） |
| drizzle-kit generate | 使用しない（手書きSQL） | 使用する（出力を自動変換） |
| SQL自動変換 | なし | statement-breakpoint→空行、INDEX→ASYNC、FK除去 |
| SQLバリデーション | なし | ALTER COLUMN TYPE, DROP COLUMN等の検出 |
| oxlintルール | なし | serial/json/references禁止 |
| 実行環境 | CLIのみ | CLI + Lambda（CDK Trigger） |
| 接続方式 | Vercel OIDC | IAM認証（Lambda実行ロール / AWSプロファイル） |
| already existsスキップ | あり | あり |

---

## Phase 2: 実装調査とテスト計画

### 1. 現在の実装構成

```
packages/db/
  src/
    schema.ts               # Drizzle スキーマ定義（User, TodoItem, relations）
    client.ts               # AuroraDSQLPool + Drizzle ORM インスタンス（Proxy遅延初期化）
    migrate.ts              # マイグレーションコアロジック（Pool受取、環境非依存）
    check-dsql-compat.ts    # drizzle-kit出力のDSQL自動変換 + バリデーション（スクリプト）
    cli.ts                  # CLIエントリポイント（getPool → migrate）
  drizzle.config.ts         # drizzle-kit設定（generate用、DB接続不要）
  migrations/
    0001_initial.sql         # 初期マイグレーション（User, TodoItem, INDEX ASYNC）
    meta/_journal.json       # drizzle-kit snapshot journal
    meta/0001_snapshot.json  # drizzle-kit snapshot

apps/cdk/lib/constructs/dsql-migrator/
  handler.ts                # Lambda ハンドラー（migrate() の薄いラッパー）
  index.ts                  # CDK Construct（DockerImageFunction + Trigger）
  Dockerfile                # esbuild バンドル + migrations/ コピー
```

### 2. 実装済み機能の確認

> **2026-03-21 更新:** Phase 2 の全タスク完了。テスト全通過（unit 43, integ 16 passed / 2 skipped）。

| 機能 | 状態 | 実装箇所 |
|------|------|----------|
| `_migrations` テーブル管理（name, executed_at） | ✅ 完了 | migrate.ts — hashカラム削除済み |
| hash検証（改竄検知） | ✅ 削除済み | migrate.ts — 名前ベースのスキップに変更 |
| SQL文分割（`\n\n` で分割） | ✅ 完了 | migrate.ts |
| 1文ずつ BEGIN/COMMIT | ✅ 完了 | migrate.ts |
| `already exists` スキップ | ✅ 完了 | migrate.ts |
| DSQL非互換パターン実行時検証 | ✅ 完了 | dsql-compat.ts: `validateStatement()` — 全パターン検出（SET/DROP NOT NULL, SET/DROP DEFAULT, DROP CONSTRAINT, TRUNCATE 追加） |
| statement-breakpoint → 空行変換 | ✅ 完了 | dsql-compat.ts: `transformSql()` — `--> statement-breakpoint\n` → `\n\n` |
| CREATE INDEX → ASYNC変換 | ✅ 完了 | dsql-compat.ts: `transformSql()` |
| REFERENCES/FK除去 | ✅ 完了 | dsql-compat.ts: `transformSql()` — インラインREFERENCES部分のみ除去（カラム定義保持）、CONSTRAINT FK行は行ごと除去 |
| ALTER COLUMN TYPE / DROP COLUMN / SERIAL等検出 | ✅ 完了 | dsql-compat.ts: `validateSql()` — 全パターン検出 |
| Proxy遅延初期化（ESM即時評価回避） | ✅ 完了 | client.ts |
| CLI（tsx --env-file） | ✅ 完了 | cli.ts, package.json |
| Lambda ハンドラー | ✅ 完了 | handler.ts |
| CDK Construct（Trigger） | ✅ 完了 | index.ts — memorySize: 2048, timeout: 15min |
| oxlint: serial/json/jsonb import禁止 | ✅ 完了 | oxlintrc.json |
| oxlint: .references() 禁止（schema.ts限定） | ⚠️ 設定済み・未動作 | oxlintrc.json overrides — oxlint v1.56.0 で `no-restricted-syntax` 未サポート |
| .ts/.mjsマイグレーション実行 | ✅ 完了 | migrate.ts — `export default async function(client)` |
| check-dsql-compat エラー時のロールバック | ❌ 不採用 | `git checkout -- migrations/` の案内で十分 |
| dsql-compat.ts 分離 | ✅ 完了 | 純粋関数（transform/validate/validateStatement）をexport。check-dsql-compat.ts は薄いCLIラッパー |
| テスト（unit） | ✅ 完了 | dsql-compat.test.ts (22), migrate.test.ts (21) |
| テスト（integ） | ✅ 完了 | dsql-compat.integ.test.ts (3), schema.integ.test.ts (4+2skip), migrate.integ.test.ts (9) |
| テスト配置 | ✅ 完了 | コロケーション（ソースの隣に `.test.ts` / `.integ.test.ts`） |
| README.md | ✅ 完了 | packages/db/README.md |
| AGENTS.md 更新 | ✅ 完了 | ALTER TABLE制約、unfixableフロー、.tsマイグレーション、テストコロケーション規約 |

### 3. テスト計画

#### 3.1 テスト対象の分類

テスト対象は3つのレイヤーに分かれる:

1. **check-dsql-compat.ts** — SQL変換 + バリデーション（純粋なファイル操作、DB不要）
2. **migrate.ts** — マイグレーションコアロジック（`pg.Pool` を受け取る）
3. **oxlintrc.json** — Lintルール（oxlint CLIの実行結果で検証）

#### 3.2 Unit Test: check-dsql-compat.ts

現在の `check-dsql-compat.ts` はスクリプトとして実装されており、関数としてexportされていない。テスト可能にするためにリファクタリングが必要。

##### リファクタリング方針

`check-dsql-compat.ts` を以下のように分離する:

```
src/
  dsql-compat.ts              # 純粋関数（transform + validate）をexport
  check-dsql-compat.ts        # CLIスクリプト（dsql-compat.ts を呼ぶ薄いラッパー）
```

##### テスト戦略: フィクスチャベース + スナップショットテスト

SQL文字列の正規表現操作は偽陽性（正常なSQLをエラーにする）と偽陰性（非互換SQLを見逃す）のリスクがある。入力は「drizzle-kit generateの出力」に限定されるため、実際の出力をフィクスチャとして使用する。

```
src/__tests__/fixtures/
  # drizzle-kit generateの実際の出力 → 変換期待結果のペア
  add-column.input.sql / add-column.expected.sql
  add-index.input.sql / add-index.expected.sql
  add-fk.input.sql / add-fk.expected.sql
  drop-column.input.sql          # バリデーションエラーになるべき入力
  change-type.input.sql          # バリデーションエラーになるべき入力
  change-not-null.input.sql      # バリデーションエラーになるべき入力
  composite.input.sql / composite.expected.sql  # 複数パターン混在
```

フィクスチャの生成方法:
1. テスト用スキーマ変更パターンを定義（初期→カラム追加、初期→インデックス追加、等）
2. 各パターンで `drizzle-kit generate` を実行し、出力SQLをフィクスチャとして保存
3. 期待結果は手動で作成・検証

##### テストケース: transform（自動変換）— フィクスチャベース

| # | テストケース | フィクスチャ | 検証方法 |
|---|-------------|-------------|----------|
| T1 | statement-breakpoint → 空行 | drizzle-kit出力（breakpoint含む） | snapshot test |
| T2 | CREATE INDEX → CREATE INDEX ASYNC | add-index.input.sql | expected.sql と一致 |
| T3 | CREATE UNIQUE INDEX → CREATE UNIQUE INDEX ASYNC | add-unique-index.input.sql | expected.sql と一致 |
| T4 | 既にASYNCのINDEXは二重変換しない | 手書き入力 | 入力と出力が同一 |
| T5 | REFERENCES除去（カラム定義は保持） | add-fk.input.sql | expected.sql と一致。カラム定義が残りREFERENCES部分のみ除去 |
| T6 | FOREIGN KEY行の除去 | add-fk.input.sql | expected.sql と一致 |
| T7 | 変換不要なSQLはそのまま | add-column.input.sql（変換不要） | 入力と出力が同一 |
| T8 | 複合変換（breakpoint + INDEX + FK） | composite.input.sql | expected.sql と一致 |

##### テストケース: validate（エラー検出）— フィクスチャベース

| # | テストケース | フィクスチャ | 期待結果 |
|---|-------------|-------------|----------|
| V1 | ALTER COLUMN TYPE検出 | change-type.input.sql | エラー（メッセージに操作名と対処法を含む） |
| V2 | DROP COLUMN検出 | drop-column.input.sql | エラー |
| V3 | SERIAL検出 | serial.input.sql | エラー |
| V4 | SET NOT NULL検出 | change-not-null.input.sql | エラー |
| V5 | DROP NOT NULL検出 | drop-not-null.input.sql | エラー |
| V6 | SET DEFAULT検出 | set-default.input.sql | エラー |
| V7 | DROP DEFAULT検出 | drop-default.input.sql | エラー |
| V8 | DROP CONSTRAINT検出 | drop-constraint.input.sql | エラー |
| V9 | 正常なSQL（エラーなし） | add-column.input.sql | エラーなし |
| V10 | SQLコメント内の非互換キーワード | 手書き: `-- ALTER TABLE TYPE comment` | エラーなし（偽陽性テスト） |
| V11 | テーブル名に非互換キーワードを含む | 手書き: `CREATE TABLE "alter_type_log"` | エラーなし（偽陽性テスト） |

#### 3.3 Unit Test: migrate.ts

`migrate()` は `pg.Pool` を受け取る設計のため、Poolをモックすることでunit testが可能。ファイルシステムもモック対象。

##### テストケース: マイグレーション実行

| # | テストケース | 条件 | 期待動作 |
|---|-------------|------|----------|
| M1 | 初回実行: _migrationsテーブル作成 | 空のDB | `CREATE TABLE IF NOT EXISTS _migrations` が実行される |
| M2 | 初回実行: マイグレーション適用 | 1つのSQLファイル | BEGIN/COMMIT で各文が実行され、_migrationsにレコード挿入 |
| M3 | 再実行: 適用済みスキップ | 既に適用済みのファイル | SQLは実行されず、スキップされる |
| M4 | 再実行: 適用済みファイル変更後も正常動作 | 適用済みファイルの内容が変更（フォーマッター等） | エラーなし。スキップされる（hash検証なし） |
| M5 | already existsスキップ | DDL実行で `already exists` エラー | ROLLBACKしてスキップ、マイグレーション自体は成功 |
| M6 | DDLエラー（already exists以外） | DDL実行で他のエラー | ROLLBACKしてエラーがthrowされる |
| M7 | DSQL非互換SQL検出: CREATE INDEX非ASYNC | `CREATE INDEX` (ASYNCなし) を含むSQL | `validateStatement` でエラーがthrowされる |
| M7a | DSQL非互換SQL検出: REFERENCES | `REFERENCES "User"("id")` を含むSQL | エラー |
| M7b | DSQL非互換SQL検出: ALTER COLUMN TYPE | `ALTER TABLE "t" ALTER COLUMN "c" TYPE varchar` | エラー |
| M7c | DSQL非互換SQL検出: DROP COLUMN | `ALTER TABLE "t" DROP COLUMN "c"` | エラー |
| M7d | DSQL非互換SQL検出: SET NOT NULL | `ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL` | エラー |
| M7e | DSQL非互換SQL検出: DROP NOT NULL | `ALTER TABLE "t" ALTER COLUMN "c" DROP NOT NULL` | エラー |
| M7f | DSQL非互換SQL検出: SET DEFAULT | `ALTER TABLE "t" ALTER COLUMN "c" SET DEFAULT 'x'` | エラー |
| M7g | DSQL非互換SQL検出: DROP DEFAULT | `ALTER TABLE "t" ALTER COLUMN "c" DROP DEFAULT` | エラー |
| M7h | DSQL非互換SQL検出: DROP CONSTRAINT | `ALTER TABLE "t" DROP CONSTRAINT "c_unique"` | エラー |
| M8 | 複数ファイルのソート順実行 | 0001.sql, 0002.sql | 番号順に実行される |
| M9 | 空のmigrationsディレクトリ | ファイルなし | _migrationsテーブル作成のみ、エラーなし |
| M10 | 複数文を含むSQLファイル | `\n\n` で区切られた3文 | 3回のBEGIN/COMMITが実行される |
| M11 | 部分適用後の再実行 | 0001適用済み、0002未適用 | 0001スキップ、0002のみ実行 |
| M12 | .tsマイグレーション実行 | `export default` 関数をexportする.tsファイル | 関数がclientを受け取って実行される |
| M13 | .sqlと.tsの混在ソート | 0001.sql, 0002.ts, 0003.sql | 番号順に実行される |

##### モック戦略

- `pg.Pool`: `connect()` → mock client（`query()`, `release()` をモック）
- `fs.readdirSync`, `fs.readFileSync`: テスト用SQLファイルの内容を返す

#### 3.4 Unit Test: oxlint ルール

oxlintルールのテストは、テスト用のTypeScriptファイルを作成し、oxlint CLIを実行して出力を検証する。

| # | テストケース | テストファイル内容 | 期待結果 |
|---|-------------|-------------------|----------|
| L1 | serial import検出 | `import { serial } from 'drizzle-orm/pg-core';` | エラー |
| L2 | json import検出 | `import { json } from 'drizzle-orm/pg-core';` | エラー |
| L3 | jsonb import検出 | `import { jsonb } from 'drizzle-orm/pg-core';` | エラー |
| L4 | 正常なimport | `import { text, uuid } from 'drizzle-orm/pg-core';` | エラーなし |
| L5 | .references()検出（schema.ts） | `userId: text('userId').references(() => users.id)` in schema.ts | ⚠️ スキップ（oxlint v1.56.0 で `no-restricted-syntax` 未サポート） |
| L6 | .references()非検出（非schemaファイル） | 同上 in actions.ts | ⚠️ スキップ（同上） |

#### 3.5 Integration Test: migrate.ts（実DSQLクラスタ）

`scripts/dsql.sh create` で作成したテスト用クラスタに対して実行する。

##### 前提条件

- `packages/db/.env` に `DSQL_ENDPOINT` と `AWS_REGION` が設定済み
- テスト用クラスタがACTIVE状態
- テスト前後で `_migrations` テーブルと作成されたテーブルをクリーンアップ

##### テストケース

| # | テストケース | 手順 | 検証 |
|---|-------------|------|------|
| I1 | 初回マイグレーション | 0001_initial.sql を適用 | `_migrations` に1レコード。`User`, `TodoItem` テーブルが存在。INDEX が作成されている |
| I2 | 冪等性（再実行） | I1の後に再度 `migrate()` 実行 | エラーなし。`_migrations` のレコード数は変わらない |
| I3 | 追加マイグレーション | 0002_add_column.sql（`ALTER TABLE "TodoItem" ADD COLUMN "priority" text;`）を追加して実行 | `_migrations` に2レコード。`TodoItem` に `priority` カラムが存在 |
| I4 | 適用済みファイル変更後の再実行 | 0001_initial.sql の内容を変更して実行 | エラーなし。適用済みとしてスキップされる |
| I5 | already existsスキップ | `_migrations` レコードを削除して再実行（テーブルは残存） | `already exists` でスキップされ、`_migrations` にレコードが再挿入される |
| I6 | 複数文の個別トランザクション | CREATE TABLE + CREATE INDEX ASYNC を含むSQL | 各文が個別トランザクションで実行される（1DDL/トランザクション制約を満たす） |
| I7 | DSQL非互換SQLの拒否 | `CREATE INDEX` (ASYNCなし) を含むSQLファイルを配置して実行 | `validateStatement` でエラー。テーブルは作成されない |
| I8 | CLIからの実行 | `pnpm --filter @repo/db run migrate` | 正常終了。I1と同等の結果 |
| I9 | Lambda ハンドラー互換性 | handler.ts と同等のコードパスで実行 | 正常終了。I1と同等の結果 |
| I10 | .tsマイグレーション（バッチデータ移行） | テーブル再作成 + バッチINSERTの.tsファイル | テーブルが再作成され、データが移行される |
| I11 | 変換後SQLのDSQL実行検証 | フィクスチャの変換後SQLをDSQLに投げる | エラーなし。変換結果が実際にDSQLで動くことの証明 |

##### クリーンアップ戦略

各テストの前後で以下を実行:
```sql
DROP TABLE IF EXISTS "TodoItem";
DROP TABLE IF EXISTS "User";
DROP TABLE IF EXISTS _migrations;
```

テスト用の一時migrationsディレクトリを使用し、本番のmigrations/を汚染しない。

#### 3.6 Integration Test: check-dsql-compat.ts（ファイルシステム）

実際のファイルシステムに一時ファイルを作成し、スクリプトを実行して変換結果を検証する。

| # | テストケース | 手順 | 検証 |
|---|-------------|------|------|
| C1 | drizzle-kit generate出力の変換 | statement-breakpoint + 非ASYNC INDEX + FK を含むSQLファイルを配置 → スクリプト実行 | ファイルが正しく変換されている |
| C2 | 変換不要ファイルは変更なし | DSQL互換のSQLファイルを配置 → スクリプト実行 | ファイル内容が変わらない |
| C3 | unfixableパターンでexit 1 | ALTER COLUMN TYPEを含むSQLファイルを配置 → スクリプト実行 | exit code 1。エラーメッセージに `git checkout -- migrations/` と `drizzle-kit generate --custom` の案内が含まれる |
| C4 | generateスクリプト統合 | `pnpm --filter @repo/db run generate` 相当の実行 | drizzle-kit generate → check-dsql-compat.ts の順に実行される |

### 4. テストの実装方針

#### 4.1 テストフレームワーク

- Unit test: vitest（プロジェクトで使用中のテストランナー）
- Integration test: vitest（`--pool=forks` で分離実行）

#### 4.2 ファイル配置

```
packages/db/
  src/
    dsql-compat.ts                    # 新規: transform/validate の純粋関数
    check-dsql-compat.ts              # リファクタ: dsql-compat.ts を呼ぶラッパー
    __tests__/
      fixtures/                       # drizzle-kit generate実出力のフィクスチャ
        add-column.input.sql
        add-column.expected.sql
        add-index.input.sql
        add-index.expected.sql
        add-fk.input.sql
        add-fk.expected.sql
        drop-column.input.sql
        change-type.input.sql
        composite.input.sql
        composite.expected.sql
        ...
      dsql-compat.test.ts             # Unit: T1-T8, V1-V11（フィクスチャ + snapshot）
      migrate.test.ts                 # Unit: M1-M13, M7a-M7h（モック）
      migrate.integ.test.ts           # Integ: I1-I11（実DSQLクラスタ）
      check-dsql-compat.integ.test.ts # Integ: C1-C4（ファイルシステム）
      oxlint-rules.integ.test.ts      # Integ: L1-L6（oxlint CLI実行）
```

#### 4.3 リファクタリング要件

テストを書くために必要な最小限のリファクタリング:

1. **check-dsql-compat.ts → dsql-compat.ts 分離**: 変換・バリデーションロジックを純粋関数としてexportする。現在のスクリプトはファイルI/Oとロジックが混在しており、unit testが困難
2. **migrate.ts の validateStatement を export**: 現在は `function` 宣言で非export。テストから直接呼べるようにする

#### 4.4 Integration Test の実行条件

- `DSQL_ENDPOINT` 環境変数が設定されている場合のみ実行
- CI環境では `scripts/dsql.sh create` でクラスタを作成してから実行
- テスト用の一時migrationsディレクトリを `os.tmpdir()` 配下に作成
- 各テストでテーブルをDROPしてクリーンな状態から開始

#### 4.5 テスト実行コマンド

```bash
# Unit test のみ
pnpm --filter @repo/db run test

# Integration test（DSQL_ENDPOINT が必要）
pnpm --filter @repo/db run test:integ

# 全テスト
pnpm --filter @repo/db run test:all
```

package.json scripts に追加:
```json
{
  "scripts": {
    "test": "vitest run --exclude '**/*.integ.test.ts'",
    "test:integ": "vitest run --include '**/*.integ.test.ts'",
    "test:all": "vitest run"
  }
}
```

### 5. 実装の優先順位

1. `dsql-compat.ts` の分離（リファクタリング）
2. `dsql-compat.test.ts`（Unit: 変換・バリデーション）— DB不要、即座に実行可能
3. `migrate.test.ts`（Unit: モック）— DB不要、即座に実行可能
4. `oxlint-rules.integ.test.ts`（Integ: oxlint CLI）— DB不要、oxlintのみ必要
5. `check-dsql-compat.integ.test.ts`（Integ: ファイルシステム）— DB不要
6. `migrate.integ.test.ts`（Integ: 実DSQLクラスタ）— DSQLクラスタ必要、最後に実行
