# v3 マイグレーションプロンプト

## 目的

このドキュメントは v2 から v3 への移行計画を立案するための下地（テンプレート）である。各派生プロジェクトはユーザー固有のスキーマ、独自拡張、データ量を持つため、このドキュメントをそのまま実行するのではなく、Phase 1 の事前評価結果を踏まえてプロジェクト固有の移行計画を作成すること。

計画立案の流れ:

1. このドキュメント全体を読み、フェーズ構成と行動規約を把握する
2. Phase 1（バックアップと事前評価）を実行し、ユーザーのスキーマ・データ・独自拡張を分析する
3. 分析結果に基づき、各フェーズの具体的なタスクとチェックポイントをプロジェクト固有の計画として文書化する
4. 計画に従って各フェーズを順番に実行する

## 前提条件

- Node.js >= v22、pnpm >= v10、Docker、IAM プロファイル設定済みの AWS CLI
- ユーザーの v2 アプリケーションソースコード
- ユーザーの AWS アカウントへのアクセス（Aurora Serverless v2 クラスタ、Cognito 等）
- **参照用の v3 キットのコピー** — ディレクトリ構造、設定ファイル、スキーマパターンはすべて v3 キットを読んで把握すること。本ドキュメントには v3 キットのコードから読み取れる情報は記載しない

## 行動規約

⚠️ **最重要ルール: フェーズを飛ばさないこと。** 特に Phase 5（データベース移行）は段階的な CDK デプロイが必要。RETAIN を設定せずに Aurora v2 リソース定義を削除すると、CloudFormation がクラスタを削除し本番データが失われる。必ず Phase 5-1（RETAIN + DSQL 追加）→ 5-2（データ移行）→ 5-3（切り替え）→ 5-4（旧リソース削除）の順にステップバイステップで進めること。

1. **現在のフェーズのチェックポイントが失敗した場合、次のフェーズに進まない。** まず問題を修正する
2. **Phase 5-4 はユーザーの明示的な承認が必要。** 削除されるリソースの一覧を提示し、確認を待つ
3. **Phase 5-2 の前に、Phase 1 の Aurora v2 スナップショットが存在することを再確認。** 存在しない場合、続行前に新しいスナップショットを作成
4. **ロールバック安全性**: Phase 5-4 の前であればいつでも、スナップショットからリストアし v2 CDK コードを再デプロイすることで Aurora v2 に戻せる。Phase 5-4 以降のロールバックにはスナップショットからのリストアと VPC リソースの再作成が必要
5. **各フェーズのデータリスク**: Phase 1〜4 はコードのみの変更（データリスクなし）。Phase 5-1 はリソースを追加するのみ。Phase 5-2 はデータをコピー（ソースは未変更）。Phase 5-3 はトラフィックを切り替えるが旧リソースは残る。**Phase 5-4 のみが破壊的**

## v3 キットから直接コピーできるファイル

以下のファイルはユーザー固有のカスタマイズを含まない基盤コードであり、v3 キットからそのままコピーする。変換や手書きは不要。

| コピー元（v3 キット）                    | 備考                                       |
| ---------------------------------------- | ------------------------------------------ |
| `pnpm-workspace.yaml`                    | —                                          |
| `oxlintrc.json`                          | —                                          |
| `.oxfmtrc.json`                          | —                                          |
| `.dockerignore`                          | —                                          |
| `packages/db/src/client.ts`              | Proxy 遅延初期化 + globalThis シングルトン |
| `packages/db/src/migrate.ts`             | マイグレーションランナーコアロジック       |
| `packages/db/src/dsql-compat.ts`         | SQL 変換 + バリデーション                  |
| `packages/db/src/migrate-cli.ts`         | マイグレーション CLI エントリポイント      |
| `packages/db/src/check-dsql-compat.ts`   | drizzle-kit generate 後処理                |
| `packages/db/drizzle.config.ts`          | —                                          |
| `packages/db/package.json`               | —                                          |
| `packages/db/tsconfig.json`              | —                                          |
| `packages/shared-types/package.json`     | —                                          |
| `packages/shared-types/tsconfig.json`    | —                                          |
| `apps/cdk/lib/constructs/database.ts`    | DSQL CfnCluster + IAM 認証                 |
| `apps/cdk/lib/constructs/dsql-migrator/` | Dockerfile, handler.ts, index.ts 一式      |
| `packages/db/src/cluster-cli.ts`         | 開発用 DSQL クラスタの作成・削除           |

以下はユーザー固有の変換が必要なため、コピーではなく手書き・変換する:

| ファイル                                   | 理由                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                | ユーザーが追加したテーブル・カラムを含む                                                                                    |
| `packages/db/migrations/`                  | ユーザーのスキーマに対応した初期マイグレーション SQL。v3 キットの `0001_initial.sql` はサンプルスキーマ用なのでコピーしない |
| `packages/shared-types/src/job-payload.ts` | ユーザーが追加したジョブ型を含む                                                                                            |
| `apps/async-job/src/handler.ts`            | ユーザーが追加したジョブの switch 分岐を含む                                                                                |
| `apps/async-job/src/jobs/`                 | ユーザーが追加したジョブハンドラを含む                                                                                      |
| `apps/webapp/Dockerfile`                   | v3 キットをベースに、ユーザーが追加した依存やビルド引数を反映する                                                           |
| `apps/async-job/Dockerfile`                | 同上                                                                                                                        |
| `apps/webapp/next.config.ts`               | v3 では `transpilePackages: ['@repo/db', '@repo/shared-types']` の追加が必要。ユーザーの既存設定を保持しつつマージする      |

## Phase 1: バックアップと事前評価

コード変更の前に、既存データを確保し現在のスキーマを把握する。

### 1-1. Aurora Serverless v2 スナップショットの作成

```bash
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier <cluster-id> \
  --db-cluster-snapshot-identifier v2-pre-migration-$(date +%Y%m%d)
```

### 1-2. スキーマとデータのダンプ

Bastion Host または VPC アクセス可能な環境から接続:

```bash
pg_dump --schema-only -h <aurora-endpoint> -U <user> -d <db> > schema-v2.sql
pg_dump --data-only -h <aurora-endpoint> -U <user> -d <db> > data-v2.sql
```

### 1-3. ユーザースキーマの分析

ユーザーの `prisma/schema.prisma` と `schema-v2.sql` の両方を読み、以下の DSQL 非互換パターンを特定する。キットのデフォルトスキーマと一致すると仮定しないこと — ユーザーは独自のテーブル・カラムを追加している。

schema.prisma を主たるデータソースとする。理由: Prisma スキーマはモデル定義が構造化されており、フィールド型・リレーション・デフォルト値の対応関係が明確。ダンプ SQL は PostgreSQL の DDL がそのまま含まれ、DSQL 非互換パターンの分離が困難。schema-v2.sql はインデックスや実行時に追加された制約の確認に補助的に使う。

| 検出対象                                 | DSQL での対処                                    | 判断基準                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERIAL` / `BIGSERIAL` 主キー            | `uuid().defaultRandom()` または IDENTITY 列      | 既存データに外部参照がある場合は UUID 変換時に参照元も更新が必要                                                                                                                                                                                                                                                           |
| `@default(uuid())` の主キー              | `uuid()` または `text()` を選択                  | **DSQL は `uuid = text` の暗黙型キャストをサポートしない。** アプリコードやクエリで文字列リテラルと比較している場合は `text()` を使うこと。`uuid()` を選ぶ場合は全ての比較箇所で型を一致させる必要がある                                                                                                                   |
| `ENUM` 型                                | `text()` + Zod バリデーション                    | 既存の ENUM 値を洗い出し、Zod スキーマに列挙する                                                                                                                                                                                                                                                                           |
| `JSON` / `JSONB` カラム                  | `jsonb()`（推奨）または `text()`                 | **DSQL は `json`/`jsonb` をサポート**（圧縮・**非インデックス**）。Prisma の `Json` は `jsonb()` にそのまま移行でき、parse/stringify も不要。検索・ソートのキーになるフィールドは別カラムに切り出す（jsonb はインデックス不可）。TEXT + 手動シリアライズを選ぶ場合は Phase 3-4 で `JSON.parse`/`JSON.stringify` を追加する |
| 外部キー制約（`@relation`）              | 削除（Drizzle `relations()` で代替）             | **`onDelete: Cascade` / `onDelete: SetNull` に依存する削除ロジックを特定すること。** DSQL は FK をサポートしないため、cascade 削除はアプリ層で `db.transaction()` 内の明示的な削除に変換が必要                                                                                                                             |
| `String[]` 型                            | `text()` + JSON シリアライズ                     | **`pg_dump` は PostgreSQL 配列リテラル `{}` 形式で出力する。** Phase 5-2 のデータ移行時に JSON 配列 `[]` に変換が必要（`JSON.parse('{}')` はオブジェクトを返すため）                                                                                                                                                       |
| インデックス（`@@index`）                | `CREATE INDEX ASYNC` に変換                      | —                                                                                                                                                                                                                                                                                                                          |
| `Decimal` / `Float` 型                   | Drizzle は `string` を返す（Prisma は `number`） | アプリコードで数値演算している箇所を特定                                                                                                                                                                                                                                                                                   |
| `@updatedAt`                             | `.$onUpdate(() => new Date())`                   | —                                                                                                                                                                                                                                                                                                                          |
| `zod-prisma-types` 等の生成 Zod スキーマ | 手書きまたは `drizzle-zod` で置き換え            | 生成ファイルの一覧を特定                                                                                                                                                                                                                                                                                                   |

各テーブルの行数も記録する — 3,000行超のテーブルは Phase 5-2 でバッチ移行が必要。

### 1-4. ユーザー独自拡張の棚卸し

v2 キットのデフォルトから追加・変更されたファイルを特定する。以降のフェーズで正しい配置先を判断するために必要。

- **独自の CDK Construct**: VPC に依存するもの（RDS に接続する Lambda 等）は Phase 5 で VPC 依存を解消する必要がある
- **独自の非同期ジョブ**: `webapp/src/jobs/` 配下のファイルを列挙
- **CI/CD パイプライン**: `.github/workflows/` 等に `npm ci`、`npx prisma generate` 等の v2 固有コマンドがないか確認
- **webapp の設定ファイル**: `next.config.ts`、`tailwind.config.ts` 等のユーザー変更箇所を把握

### チェックポイント

- スナップショットの存在を確認（`aws rds describe-db-cluster-snapshots`）
- ダンプファイルが空でないことを確認
- 全テーブルの非互換パターンと行数を記録した分析結果が完成
- ユーザー独自拡張の棚卸しが完成

## Phase 2: パッケージマネージャ移行 + モノレポ構造化 + リンター導入

pnpm 移行、ディレクトリ再構成、リンター導入を1つのフェーズで行う。理由: `pnpm-workspace.yaml` は `apps/*` と `packages/*` を参照するため、ディレクトリ構造が先に存在しないと `pnpm install` が失敗する。リンターを同時に入れることで、Phase 3 の Drizzle スキーマ作成時に `serial`/`json`/`jsonb` の import を即座に検出できる。

### 2-1. ディレクトリ再構成

v3 キットのディレクトリ構造を参照し、ユーザーのプロジェクトを再構成する。主な変更:

- `webapp/` → `apps/webapp/`（`src/jobs/` を除去）
- `cdk/` → `apps/cdk/`
- `webapp/src/jobs/` → `apps/async-job/` として抽出
- `packages/db/` を新規作成
- `packages/shared-types/` を新規作成

ユーザーが追加した独自コードの配置先を判断する:

- DB アクセスを含む共有ロジック → `packages/` 配下に抽出を検討
- webapp 固有のロジック → `apps/webapp/` に残す
- 非同期ジョブ → `apps/async-job/src/jobs/` に移動し、ペイロード型を `packages/shared-types/` に追加

### 2-2. パッケージマネージャ移行（npm → pnpm）

1. 「v3 キットから直接コピーできるファイル」セクションに記載のファイルをコピーする
2. `package-lock.json` を削除
3. 各パッケージの `package.json` を v3 キットを参照して作成。import パスを更新
4. `pnpm install` を実行

pnpm はデフォルトで strict モード（`shamefully-hoist=false`）。`.npmrc` を作成してはならない — `shamefully-hoist=true` にすると Docker ビルドで未宣言依存が隠蔽される。

### 2-3. リンター移行 + pre-commit フック導入（ESLint → oxlint）

1. 全 `package.json` から `eslint`、`prettier`、`eslint-config-next`、関連パッケージを削除
2. v3 キットからコピー済みの `oxlintrc.json` を確認（DSQL 非互換 import のブロックルールが含まれている）
3. ルートの `package.json` を v3 キットに合わせて更新:
   - ルートレベルのスクリプトエイリアス（`dev`、`build`、`lint`、`test` 等）を削除。各サブパッケージが自身のスクリプトを持つため不要
   - `simple-git-hooks` と `lint-staged` を `devDependencies` に追加
   - `"prepare": "simple-git-hooks"` スクリプトを追加（`pnpm install` 時にフックを自動インストール）
   - `simple-git-hooks` と `lint-staged` の設定を追加（v3 キットのルート `package.json` を参照）
4. `pnpm install` を実行してフックをインストール

### 2-4. npm/npx の残存を除去

プロジェクト全体から `npm` / `npx` コマンドの残存を除去する。対象は `.ts`、`.json` だけでなく、Dockerfile、CI/CD ワークフロー（`.yml`）、シェルスクリプトも含む:

```bash
rg 'npm |npx ' -g '!node_modules' -g '!pnpm-lock.yaml'
```

主な変換:

- `npm ci` → `pnpm install --frozen-lockfile`
- `npm run <script>` → `pnpm run <script>`
- `npx <cmd>` → `pnpm exec <cmd>`
- Dockerfile 内の `npm ci` → `corepack enable && corepack prepare pnpm@<version> --activate && pnpm install --frozen-lockfile`

### チェックポイント

- `pnpm install` が終了コード 0 で完了
- `pnpm -r run lint` が終了コード 0（oxlint の `typeCheck: true` が型チェックも行うため `tsc --noEmit` は不要）
- ESLint/Prettier の import が残っていない
- `rg 'npm |npx ' -g '!node_modules' -g '!pnpm-lock.yaml'` で npm/npx の残存がないことを確認

## Phase 3: ORM 移行（Prisma → Drizzle）

### 3-1. ユーザーの Prisma スキーマを分析

Phase 1-3 の分析結果を元に、`prisma/schema.prisma` の各モデルについて変換計画を立てる:

1. 全モデルを列挙し、各フィールドの DSQL 互換な Drizzle 型を決定
2. `@relation` で定義されたリレーションを Drizzle `relations()` に変換する対応表を作成
3. Phase 1-3 で特定した生成 Zod スキーマの置き換え方針を決定

### 3-2. Drizzle スキーマの作成

Phase 3-1 の変換計画に従い、`packages/db/src/schema.ts` に Drizzle スキーマを手書きする。v3 キットの `schema.ts` をパターンの参照にすること。

**`drizzle-kit introspect` を Aurora v2 に対して使わないこと** — 出力は `SERIAL`、`.references()`、その他の DSQL 非互換パターンを含み、全面的な書き直しが必要になる。schema.prisma から手書きの方が確実。

### 3-3. 初期マイグレーション SQL の生成

v3 キットの `packages/db/migrations/` にはサンプルスキーマ用の `0001_initial.sql` と `meta/` が含まれている。ユーザーのスキーマ用の初期マイグレーションを生成する前に、これらを削除する:

```bash
rm -rf packages/db/migrations/*
```

その後、生成を実行:

```bash
pnpm --filter @repo/db run generate
```

`check-dsql-compat.ts` が自動変換とバリデーションを実行する。エラーが出た場合は AGENTS.md の「Database migration」セクションの手順に従う。

### 3-4. アプリケーションコードの変換

ユーザーのコードベースで Prisma を import している全ファイルを特定し（`rg '@prisma|from.*prisma' --type ts`）、Drizzle API に変換する。v3 キットの Server Action 実装を参照パターンとして使うこと。

主な変換ポイント:

- `import { prisma } from '@/lib/prisma'` → `import { db } from '@repo/db/client'`
- `import { ... } from '@prisma/client'` → `import { ... } from '@repo/db/schema'`
- v2 の `prisma.ts`（リトライ拡張付き PrismaClient）は削除。DSQL は IAM 認証で接続し、Aurora v2 のコールドスタート・idle timeout 問題がないためリトライロジックは不要
- `next.config.ts` に `transpilePackages: ['@repo/db', '@repo/shared-types']` を追加（ユーザーの既存設定を保持しつつマージ）
- **Json カラムの全使用箇所を洗い出す**（`rg 'Json|\.json\b' --type ts` でスキーマ定義と読み書き箇所を特定）。Prisma は Json 型を自動で parse/stringify するが、Drizzle の `text()` は手動変換が必要。読み出し時に `JSON.parse()`、書き込み時に `JSON.stringify()` を追加すること
- **Prisma の nested create（暗黙トランザクション）を `db.transaction()` に変換する。** 特に `onDelete: Cascade` に依存していた削除ロジックは、`db.transaction()` 内で子テーブルを先に削除してから親テーブルを削除するように書き換えること
- **`db.query.*.findMany()` を `exists()`/`notExists()` サブクエリと組み合わせないこと。** `findMany()` は内部でテーブルにエイリアスを付与するが、`where`/`extras` 内のカラム参照は元テーブル名で展開されるため `invalid reference to FROM-clause entry for table` エラーになる。`db.select().from().leftJoin()` に書き換えること。`findFirst()` はサブクエリなしなら安全。詳細は drizzle-team/drizzle-orm#3068

### 3-5. クリーンアップ

1. 全 `package.json` から `@prisma/client`、`prisma`、`zod-prisma-types` 等の Prisma 関連パッケージを削除
2. `prisma/` ディレクトリ（schema.prisma、migrations/）を削除
3. `package.json` から `prisma generate` スクリプトを削除

### 3-6. 開発用 DSQL クラスタでの検証

本番データベースに触れる前に、開発用 DSQL クラスタでスキーマとアプリコードの動作を検証する。v3 キットの `packages/db` の cluster コマンドを使う:

```bash
pnpm --filter @repo/db run cluster create --region <region>
```

このスクリプトは開発用 DSQL クラスタを作成し、`packages/db/.env` に接続情報を自動で書き込む。

検証手順:

1. マイグレーションを実行してスキーマが DSQL に通ることを確認:
   ```bash
   pnpm --filter @repo/db run migrate
   ```
2. webapp の dev server を起動して CRUD 操作が動作することを確認:
   ```bash
   cd apps/webapp && pnpm run dev
   ```
3. 問題があればスキーマやアプリコードを修正し、再検証する

検証完了後、開発用クラスタは残しておく（Phase 5 の本番移行完了後に削除）:

```bash
# Phase 5 完了後に実行
pnpm --filter @repo/db run cluster delete --region <region>
```

### チェックポイント

- `pnpm -r run lint` が終了コード 0（oxlint が DSQL 非互換パターンを検出しないことを確認）
- `pnpm -r run build` が終了コード 0
- Prisma の import が残っていない（`rg '@prisma|from.*prisma' --type ts` が結果なし）
- 開発用 DSQL クラスタでマイグレーションが成功し、アプリが動作する

## Phase 4: CDK 移行

v3 キットの CDK コードを参照し、ユーザーの CDK コードを更新する。Phase 5 のデータベース移行に先立ち、DSQL 以外の CDK 変更をここで完了させる。

### 4-1. Dockerfile の更新

webapp と async-job の Dockerfile を v3 のパターンに更新する。v3 キットの Dockerfile をベースに、ユーザーが追加した独自の依存やビルド引数を反映する。主な変更点:

- `npm ci` → pnpm workspaces 対応（`corepack enable` + `pnpm install --frozen-lockfile`）
- `npx prisma generate` の削除
- esbuild の ESM 出力（`--format=esm`、出力ファイルは `.mjs` 拡張子）
- モノレポルートからのビルドコンテキスト
- **`.dockerignore` に `**/.env.local`を含めること。**`COPY apps/webapp/`で`.env.local`が Docker イメージに混入すると、Next.js がビルド時・ランタイムで読み込み、Lambda 環境変数より優先される（例:`AMPLIFY_APP_ORIGIN=http://localhost:3011` が Cognito コールバックを localhost に向ける）

### 4-2. CDK Construct の更新

- dsql-migrator Construct を追加（ただし Phase 5-1 まではデプロイしない）
- async-job の Lambda 関数定義を追加
- v2 の `prisma generate` や `prisma db push` に依存するビルドステップを削除
- ユーザーが追加した独自 Construct は維持する。ただし VPC に依存する Construct がある場合は Phase 5-3 で VPC 依存を解消する必要があるため、ここで特定しておく

### チェックポイント

- `cd apps/cdk && pnpm run build` が終了コード 0
- `pnpm -r run test:unit` が終了コード 0（CDK テストがある場合）

### 4-3. 段階的ビルド・動作確認

静的チェック（lint, build, tsc）だけでは不十分。ESM モジュールの即時評価、環境変数の読み込み、Docker 内のパス解決、Lambda ランタイムの挙動など、ビルドが通っても実行時にクラッシュする問題が多い。以下の順序で段階的に検証し、各段階で問題を発見・修正してから次に進むこと。

#### 4-3a. lint → build

```bash
pnpm -r run lint
pnpm --filter webapp run build
cd apps/cdk && pnpm run build
pnpm -r run test:unit   # CDK テストがある場合
```

#### 4-3b. ローカル Docker イメージビルド

Dockerfile が正しく動作するか、CDK を通さずに直接確認する。pnpm workspaces + Docker の組み合わせは罠が多い（`--filter` の推移的依存解決、`.dockerignore` の読み込み、esbuild の外部パッケージ解決）。

```bash
# async-job
docker build --platform linux/arm64 -f apps/async-job/Dockerfile -t test-async-job:local .
docker run --rm --entrypoint /bin/sh test-async-job:local -c "ls -la /var/task/"

# dsql-migrator
docker build --platform linux/arm64 -f apps/cdk/lib/constructs/dsql-migrator/Dockerfile -t test-migrator:local .
docker run --rm --entrypoint /bin/sh test-migrator:local -c "ls -la /var/task/ && cat /var/task/migrations/*.sql"

# webapp（CodeBuild で実行されるため手元では省略可。ただし Dockerfile の構文エラーは確認できる）
docker build --platform linux/arm64 -f apps/webapp/Dockerfile -t test-webapp:local .
```

確認事項:

- esbuild の出力が `.mjs` 拡張子であること
- `@aws/aurora-dsql-node-postgres-connector` がバンドルに含まれていること（`--external:@aws-sdk/*` で除外されないこと）
- migrations/ ディレクトリが正しくコピーされていること

CDK と同じビルドプロセスを再現する場合は `cdk synth` 後に `cdk.out/manifest.json` → `dockerImages` でアセットハッシュを取得し、`cd cdk.out/asset.<hash> && docker build --platform linux/arm64 -f <Dockerfile相対パス> -t test:local .` でビルドできる。

#### 4-3c. ローカルマイグレーション実行

実際の DSQL クラスタに対してマイグレーションを実行する。ビルドが通っても、ESM モジュールの即時評価や `.env` の読み込みでクラッシュする可能性がある。

```bash
pnpm --filter @repo/db run migrate
```

確認事項:

- マイグレーションが成功し、`_migrations` テーブルにレコードが挿入されること
- 再実行で冪等（既に適用済みのマイグレーションがスキップされること）

#### 4-3d. ローカルデバッグサーバー + ブラウザ確認

`apps/webapp/.env.local` に実際の Cognito / DSQL / AppSync の値を設定し、ローカルサーバーを起動してブラウザで操作する。

```bash
cd apps/webapp && pnpm run dev
```

確認事項:

- サインインページが表示されること
- Cognito Managed Login でログインできること
- Todo の CRUD（作成・完了・編集・削除）が動作すること

## Phase 5: データベース移行（Aurora Serverless v2 → DSQL）

このフェーズはデータ損失を防ぐため段階的な CDK デプロイが必要。**Phase 5-1 と 5-3 の2回のデプロイを1回にまとめないこと** — RETAIN を設定せずに Aurora v2 リソース定義を削除すると、CloudFormation がクラスタを削除し本番データが失われる。Phase 5-1 で RETAIN を設定してから初めて、Phase 5-3 でリソース定義を安全に削除できる。

### Phase 5-1: DSQL クラスタ作成（CDK デプロイ 1回目）

1. **Aurora v2 リソースに RemovalPolicy.RETAIN を設定**: CDK の Aurora Serverless v2 クラスタ、VPC、関連リソースに `removalPolicy: cdk.RemovalPolicy.RETAIN` を追加。これにより CloudFormation の `DeletionPolicy` が `Retain` に変わり、後のデプロイでリソース定義を削除しても実リソースは残る。**注意: `Vpc.applyRemovalPolicy(RETAIN)` は子リソース（サブネット、ルートテーブル、インターネットゲートウェイ等）に伝播しない。** VPC を RETAIN する場合は、`vpc.node.findAll()` で子リソースを列挙し個別に `applyRemovalPolicy(RETAIN)` を設定するか、Phase 5-3 で VPC リソース定義を削除する際に2段階デプロイ（1回目: Lambda の VPC 設定を外す → 2回目: VPC 定義を削除）で ENI の解放を待つこと。

2. **CDK に DSQL クラスタを追加**: v3 キットからコピー済みの `database.ts` を使用。webapp と async-job はまだ Aurora v2 に接続したまま。

3. **デプロイ**:
   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

**チェックポイント**: DSQL クラスタが ACTIVE（`aws dsql get-cluster --identifier <id>`）。Aurora v2 クラスタがデータ付きでまだ存在。

### Phase 5-2: データ移行

#### DSQL 接続の切り替え

`packages/db/.env` を Phase 5-1 で作成した本番 DSQL クラスタに切り替える（Phase 3-6 で開発用クラスタを設定済みの場合は上書き）:

```
DSQL_ENDPOINT=<Phase 5-1 で作成したクラスタのエンドポイント>
AWS_REGION=<リージョン>
```

エンドポイントは Phase 5-1 のデプロイ出力（`DatabaseClusterEndpoint`）または `aws dsql get-cluster` で取得できる。

#### スキーマの作成

DSQL クラスタに対してマイグレーションランナーを実行しテーブルを作成:

```bash
pnpm --filter @repo/db run migrate
```

#### データの移行

Phase 1-3 で記録した各テーブルの行数に基づいて移行方法を選択する。

**DSQL は `COPY FROM STDIN` をサポートする。** `pg_dump --data-only` のデフォルト出力（COPY 形式）をそのまま `psql` で投入できるため、小〜中規模データの移行では最も簡単な方法。ただし DSQL の 3,000 行/トランザクション制限があるため、大テーブルは COPY 文をテーブルごとに分割し、各 COPY を個別トランザクションで実行すること。

`pg_dump --data-only` で取得したダンプを DSQL に投入する場合、以下の変換が必要:

- `pg_dump` のプリアンブル（`SET`、`SELECT pg_catalog.*`、`\restrict`、`\unrestrict`）を除去
- `_prisma_migrations` テーブルのデータを除去（Drizzle は `_migrations` テーブルを使用）
- **`String[]` 型カラム**: `pg_dump` は PostgreSQL 配列リテラル `{}` 形式で出力する。Drizzle では `text` 型に JSON 文字列 `[]` として格納するため、`{}` → `[]` に変換が必要。変換しないと `JSON.parse('{}')` がオブジェクト `{}` を返し、配列として扱う箇所でエラーになる

v3 のマイグレーションランナーは `.sql` と `.mjs` をサポートする（`.ts` は非対応 — local と Lambda で同一ファイルを無変換で実行するため。[ADR-005](adr-005-migration-file-format.ja.md) 参照）。`packages/db/migrations/` にデータ移行用の `.mjs` ファイルを作成し、以下の形式で実装する（型は JSDoc で補う）:

```js
/** @param {import('pg').PoolClient} client */
export default async function (client) {
  // Phase 1-2 のダンプデータを DSQL 互換に変換して INSERT
  // SERIAL PK → UUID 値（参照元テーブルの FK カラムも同じ UUID に更新）
  // ENUM 値 → TEXT 値（値自体は同じ文字列）
  //
  // 3,000行/トランザクション制限に注意 — 500〜1,000行単位でバッチ分割
  await client.query('BEGIN');
  await client.query(`INSERT INTO "TableName" (...) VALUES ...`);
  await client.query('COMMIT');
}
```

非常に大きなテーブルには [Agentic migration with AI tools](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html) を参照。

#### データ整合性の検証

各テーブルについて Aurora v2 と DSQL の行数を比較:

```sql
-- Aurora v2 上
SELECT count(*) FROM "TableName";
-- DSQL 上
SELECT count(*) FROM "TableName";
```

**チェックポイント**: 全テーブルの行数が Aurora v2 と DSQL で一致。

### Phase 5-3: アプリケーション切り替え（CDK デプロイ 2回目）

1. **CDK を更新**: Aurora v2 リソース定義を削除（RETAIN が設定されているため実リソースは残る）。webapp と async-job の環境変数を DSQL エンドポイントに変更。Lambda 関数から VPC 設定を削除。Phase 4-2 で特定した VPC 依存の独自 Construct がある場合は、ここで VPC 依存を解消する。

2. **デプロイ**（本番環境ではメンテナンスウィンドウを推奨）:

   ```bash
   cd apps/cdk && pnpm exec cdk deploy --all
   ```

3. **VPC ENI クリーンアップ**: Lambda 関数が VPC から外れると、Hyperplane ENI が最大20分間 `available` 状態で残り、セキュリティグループとサブネットの削除をブロックする。CloudFormation が `DELETE_FAILED` を報告する場合:

   ```bash
   # 孤立した ENI を検索
   aws ec2 describe-network-interfaces \
     --filters "Name=description,Values=AWS Lambda VPC ENI*" "Name=status,Values=available" \
     --region <region>
   # 各 ENI を削除
   aws ec2 delete-network-interface --network-interface-id <eni-id> --region <region>
   # DELETE_FAILED のセキュリティグループを削除
   aws ec2 delete-security-group --group-id <sg-id> --region <region>
   ```

**チェックポイント**: アプリケーションが DSQL 経由でエンドツーエンドで動作 — サインイン、CRUD 操作、リアルタイム通知付き非同期ジョブ。

### Phase 5-4: 旧リソース削除（CDK デプロイ 3回目 — または手動）

⚠️ **ポイントオブノーリターン。続行前にユーザーの明示的な確認を求めること。**

1. RETAIN された Aurora v2 クラスタ、VPC、NAT Instance、Bastion Host を削除
2. CDK（RETAIN リソースを削除してデプロイ）または AWS コンソール/CLI で手動実行可能

**チェックポイント**: 旧リソースが削除済み。VPC コストが残っていない。
