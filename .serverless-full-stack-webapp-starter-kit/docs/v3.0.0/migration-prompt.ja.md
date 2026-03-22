# v3 マイグレーションプロンプト

## 目的

あなたは Serverless Full Stack WebApp Starter Kit の v2 から v3 へユーザーのアプリケーションを移行する AI コーディングエージェントです。このドキュメントがあなたの移行計画です — 開始前に全体を読み、各フェーズを順番に実行してください。

ユーザーは v2 ベースのアプリケーション（キットをコピーして構築した独自コード）と、本番データを持つ稼働中の Aurora Serverless v2 データベースを持っています。あなたの仕事は、各フェーズのチェックポイントでデータ損失を防ぎながら、コードベースとデータを安全に移行することです。

## 前提条件

- Node.js >= v22、pnpm >= v10、Docker、IAM プロファイル設定済みの AWS CLI
- ユーザーの v2 アプリケーションソースコード
- ユーザーの AWS アカウントへのアクセス（Aurora Serverless v2 クラスタ、Cognito 等）
- 参照用の v3 キットのコピー（スキーマパターン、設定例）

## Phase 0: バックアップと事前評価

コード変更の前に、既存データを確保し現在のスキーマを把握する。

1. **Aurora Serverless v2 スナップショットの作成**:
   ```bash
   aws rds create-db-cluster-snapshot \
     --db-cluster-identifier <cluster-id> \
     --db-cluster-snapshot-identifier v2-pre-migration-$(date +%Y%m%d)
   ```

2. **スキーマとデータのダンプ**（Bastion Host または VPC アクセス可能な環境から接続）:
   ```bash
   pg_dump --schema-only -h <aurora-endpoint> -U <user> -d <db> > schema-v2.sql
   pg_dump --data-only -h <aurora-endpoint> -U <user> -d <db> > data-v2.sql
   ```

3. **現在のスキーマの評価**: ユーザーの全スキーマを確認 — 全テーブル、カラム、データ型、インデックス、制約。キットのデフォルトスキーマと一致すると仮定しないこと。以下を特定:
   - SERIAL/BIGSERIAL 主キーを持つテーブル → UUID または IDENTITY への変換が必要
   - ENUM 型 → TEXT になる
   - JSON/JSONB カラム → TEXT になる
   - 外部キー制約 → 削除される（代わりに Drizzle `relations()` を使用）
   - インデックス → `ASYNC` キーワードが必要
   - テーブルごとの行数（3,000行超のテーブルはバッチ移行が必要）

4. **チェックポイント**: スナップショットの存在を確認（`aws rds describe-db-cluster-snapshots`）、ダンプファイルが空でないことを確認、スナップショットからリストアできることを確認。

## Phase A: パッケージマネージャ移行（npm → pnpm）

1. プロジェクトルートに `pnpm-workspace.yaml` を作成
2. `package-lock.json` を削除
3. `shamefully-hoist=false`（strict モード）で `.npmrc` を作成
4. `pnpm install` を実行

**チェックポイント**: `pnpm install` が終了コード 0 で完了。

## Phase B: モノレポ構造化（apps/ + packages/）

プロジェクトを v3 のレイアウトに再構成:

```
apps/
  cdk/             ← cdk/ から
  webapp/          ← webapp/ から（src/jobs/ を除去）
  async-job/       ← webapp/src/jobs/ から抽出
packages/
  db/              ← 新規: Drizzle スキーマ、クライアント、マイグレーションランナー
  shared-types/    ← 新規: ジョブペイロード型
```

1. ディレクトリを移動し import パスを更新
2. `pnpm-workspace.yaml` を `apps/*` と `packages/*` を含むよう更新
3. 各パッケージの `tsconfig.json` 参照を更新

**チェックポイント**: 各パッケージで `tsc --noEmit` が終了コード 0。

## Phase C: ORM 移行（Prisma → Drizzle）

### スキーマ変換

Phase 0 のスキーマダンプを参照し、v3 のパターンに従って `packages/db/src/schema.ts` に Drizzle スキーマを手書きする。Aurora v2 に対して `drizzle-kit introspect` を使わないこと — 出力は SERIAL、`.references()`、その他の DSQL 非互換パターンを使用しており、全面的な書き直しが必要になる。

DSQL 互換スキーマルール:
- `SERIAL` / `BIGSERIAL` → `uuid('id').primaryKey().defaultRandom()` または IDENTITY カラム
- `ENUM` → `text('status')`（アプリケーション層で Zod によるバリデーション）
- `JSON` / `JSONB` → `text('data')`（アプリケーションコードでシリアライズ/デシリアライズ）
- 外部キー → `.references()` を使わない。クエリビルダーの join 用に `relations()` を別途定義
- `@updatedAt` → `.$onUpdate(() => new Date())` を使用するか、アプリケーションコードで明示的に設定
- `numeric` 型: Prisma は `number` を返すが、Drizzle は `string` を返す。アプリケーションコードを適宜更新

### クエリ変換パターン

| Prisma | Drizzle |
|--------|---------|
| `prisma.model.findMany()` | `db.query.model.findMany()` または `db.select().from(table)` |
| `prisma.model.findUnique({ where: { id } })` | `db.query.model.findFirst({ where: eq(table.id, id) })` |
| `prisma.model.create({ data })` | `db.insert(table).values(data)` |
| `prisma.model.createMany({ data })` | `db.insert(table).values([...data])` |
| `prisma.model.update({ where, data })` | `db.update(table).set(data).where(eq(table.id, id))` |
| `prisma.model.delete({ where })` | `db.delete(table).where(eq(table.id, id))` |
| `prisma.$transaction([...])` | `db.transaction(async (tx) => { ... })` |

### クリーンアップ

1. 全 `package.json` から `@prisma/client`、`prisma`、Prisma 関連パッケージを削除
2. `prisma/` ディレクトリ（schema.prisma、migrations/）を削除
3. `package.json` から `prisma generate` スクリプトを削除
4. `zod-prisma-types` を使用していた場合、生成された Zod スキーマを手書きまたは `drizzle-zod` に置き換え

**チェックポイント**: `pnpm run build` が終了コード 0。Prisma の import が残っていない（`rg '@prisma|from.*prisma' --type ts` が結果なし）。

## Phase D: データベース移行（Aurora Serverless v2 → DSQL）

このフェーズはデータ損失を防ぐため3回の個別 CDK デプロイが必要。単一デプロイを試みないこと — Aurora v2 クラスタと全データが削除される。

### Phase D-1: DSQL クラスタ作成（CDK デプロイ 1回目）

1. **Aurora v2 リソースに RemovalPolicy.RETAIN を設定**: CDK 変更の前に、Aurora Serverless v2 クラスタ、VPC、関連リソースに `removalPolicy: cdk.RemovalPolicy.RETAIN` を追加。スタック更新時に CloudFormation がこれらを削除することを防止。

2. **CDK に DSQL クラスタを追加**: DSQL 用の `CfnCluster` リソースを追加。webapp と async-job はまだ Aurora v2 に接続したまま。

3. **デプロイ**:
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

**チェックポイント**: DSQL クラスタが ACTIVE（`aws dsql get-cluster --identifier <id>`）。Aurora v2 クラスタがデータ付きでまだ存在。

### Phase D-2: データ移行

1. **DSQL スキーマの作成**: 新しい DSQL クラスタに対してマイグレーションランナーを実行しテーブルを作成:
   ```bash
   pnpm --filter @repo/db run migrate
   ```

2. **Aurora v2 から DSQL へのデータ移行**:

   小規模データセット（テーブルあたり 3,000行未満）の場合:
   - Phase 0 の `pg_dump --data-only` 出力を使用
   - DSQL 互換性のためデータを変換（SERIAL PK → UUID 値、ENUM → TEXT 値）
   - マイグレーションスクリプトで DSQL に INSERT

   大規模データセット（テーブルあたり 3,000行超）の場合:
   - 500〜1,000行単位でバッチ INSERT（DSQL の3,000行/トランザクション制限）
   - 非常に大きなテーブルには DMS + S3 を検討（[sample-migration-aurora-dsql-using-ai](https://github.com/aws-samples/sample-migration-aurora-dsql-using-ai) を参照）
   - 複雑な変換には `export default async function(client: PoolClient)` の `.ts` マイグレーションファイルを使用

   AI 支援の DSQL 移行パターンについては [Agentic migration with AI tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html) を参照。

3. **データ整合性の検証**: 各テーブルについて Aurora v2 と DSQL の行数を比較:
   ```sql
   -- Aurora v2 上
   SELECT count(*) FROM "TableName";
   -- DSQL 上
   SELECT count(*) FROM "TableName";
   ```

**チェックポイント**: Aurora v2 と DSQL の間で全テーブルの行数が一致。

### Phase D-3: アプリケーション切り替え（CDK デプロイ 2回目）

1. **CDK を更新**: Aurora v2 リソース定義を削除（RETAIN が設定されているため実リソースは残る）。webapp と async-job の環境変数を DSQL エンドポイントに変更。Lambda 関数から VPC 設定を削除。

2. **デプロイ**（本番環境ではメンテナンスウィンドウを推奨）:
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

3. **既知の問題 — VPC ENI クリーンアップ**: Lambda 関数が VPC から外れると、AWS は Hyperplane ENI を即座に削除しない。最大20分間 `available` 状態で残り、セキュリティグループとサブネットの削除をブロック。CloudFormation が `DELETE_FAILED` を報告する場合がある。

   回避策:
   ```bash
   # 孤立した ENI を検索
   aws ec2 describe-network-interfaces \
     --filters "Name=description,Values=AWS Lambda VPC ENI*" "Name=status,Values=available" \
     --region <region>
   # 各 ENI を削除
   aws ec2 delete-network-interface --network-interface-id <eni-id> --region <region>
   # CloudFormation が DELETE_FAILED にしたセキュリティグループを削除
   aws ec2 delete-security-group --group-id <sg-id> --region <region>
   ```

**チェックポイント**: アプリケーションが DSQL 経由でエンドツーエンドで動作 — サインイン、CRUD 操作、リアルタイム通知付き非同期ジョブ。

### Phase D-4: 旧リソース削除（CDK デプロイ 3回目 — または手動）

⚠️ **ポイントオブノーリターン。続行前にユーザーの明示的な確認を求めること。**

1. RETAIN された Aurora v2 クラスタ、VPC、NAT Instance、Bastion Host を削除
2. CDK（RETAIN リソースを削除してデプロイ）または AWS コンソール/CLI で手動実行可能

**チェックポイント**: 旧リソースが削除済み。VPC コストが残っていない。

## Phase E: リンター移行（ESLint → oxlint）

1. 全 `package.json` から `eslint`、`prettier`、`eslint-config-next`、関連パッケージを削除
2. ルートの `devDependencies` に `oxlint` を追加
3. DSQL 固有ルール付きの `oxlintrc.json` を作成:
   - `no-restricted-imports`: `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial`, `json`, `jsonb` をブロック
4. `package.json` の lint スクリプトを更新: `eslint` → `oxlint`
5. フォーマッティング用に `oxfmt` を追加（Prettier の代替）

**チェックポイント**: `pnpm run lint` が終了コード 0。ESLint/Prettier の import が残っていない。

## セーフガード

- **現在のフェーズのチェックポイントが失敗した場合、次のフェーズに進まないこと。** まず問題を修正する。
- **Phase D-4 はユーザーの明示的な承認が必要。** 削除されるリソースの一覧を提示し、確認を待つ。
- **Phase D-2 の前に、Phase 0 の Aurora v2 スナップショットが存在することを再確認。** 存在しない場合、続行前に新しいスナップショットを作成。
- **ロールバック安全性**: Phase D-4 の前であればいつでも、スナップショットからリストアし v2 CDK コードを再デプロイすることで Aurora v2 に戻せる。Phase D-4 以降のロールバックにはスナップショットからのリストアと VPC リソースの再作成が必要。
- **各フェーズは独立して安全**: Phase A〜C はコードのみの変更（データリスクなし）。Phase D-1 はリソースを追加するのみで削除しない。Phase D-2 はデータをコピー（ソースは未変更）。Phase D-3 はトラフィックを切り替えるが旧リソースは残る。Phase D-4 のみが破壊的。

## 破壊的変更リファレンス

### パッケージマネージャ

- `npm ci` → `pnpm install`
- `npm run <script>` → `pnpm run <script>`
- `package-lock.json` → `pnpm-lock.yaml`

### プロジェクト構造

```
webapp/          → apps/webapp/
cdk/             → apps/cdk/
                   apps/async-job/     （新規、webapp/src/jobs/ から抽出）
                   packages/db/        （新規、Drizzle スキーマ + マイグレーションランナー）
                   packages/shared-types/ （新規、ジョブペイロード型）
```

### ORM（Prisma → Drizzle）

- `prisma generate` ステップなし — Drizzle は純粋 TypeScript
- スキーマは `packages/db/src/schema.ts` に `pgTable()` API で定義
- リレーションは `relations()` を使用（クエリビルダー専用、SQL レベルの FK なし）
- Zod スキーマは手書き、ORM からの生成ではない
- `numeric` 型: Prisma は `number` を返すが、Drizzle は `string` を返す

### データベース（Aurora Serverless v2 → DSQL）

- VPC、NAT Instance、Bastion Host なし
- ユーザー名/パスワードの代わりに IAM 認証
- DSQL 制約: SERIAL なし（UUID/IDENTITY を使用）、FK なし、JSON/JSONB なし（TEXT を使用）、1トランザクション1DDL、`CREATE INDEX ASYNC` のみ
- ALTER TABLE 制限: ADD COLUMN、RENAME、identity 操作、OWNER TO、SET SCHEMA のみ
- 書き込みトランザクションあたり3,000行
- TRUNCATE なし（`DELETE FROM` を使用）

### リンティング（ESLint → oxlint）

- `eslint` → `oxlint`
- `prettier` → `oxfmt`
- `oxlintrc.json` に DSQL 固有の `no-restricted-imports` ルール

### pnpm モノレポでの Docker ビルド

- `pnpm install --filter` は strict モードで推移的依存をホイストしない。Dockerfile では `--filter` なしの `pnpm install --frozen-lockfile` を使用。
- CDK `DockerImageCode.fromImageAsset` は `.dockerignore` を読むために `ignoreMode: IgnoreMode.DOCKER` が必要。
- esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要。
- `--external:@aws-sdk/*` は `@aws/*` パッケージ（例: `@aws/aurora-dsql-node-postgres-connector`）を除外しない。明示的にバンドルすること。
