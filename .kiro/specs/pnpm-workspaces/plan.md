# pnpm workspaces モノレポ化 + DSQL/Drizzle 移行

refs:
- https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/98
- https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/91
- https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/discussions/94

## 前提条件

- main ブランチから v3 ブランチを切って並行開発する
- 以下の PR が main にマージされた後、v3 ブランチにリベースする:
  - #119 `fix: prevent CloudFront cache poisoning for Next.js RSC responses` — パス変更のみでコンフリクト解消は機械的
  - #120 `fix(auth): improve auth error handling and fix Link CORS issue` — パス変更のみでコンフリクト解消は機械的
  - #121 `fix(prisma): add retry for Aurora Serverless v2 connection errors` — v3 で Prisma/Aurora が消えるため v3 側を採用して解消
- 3 PR マージ後に最後の v2 リリースを切り、その後 v3 をマージする

## なぜこの変更が必要か

1. webapp/ に Next.js・非同期ジョブ・マイグレーションランナーが同居しており、job.Dockerfile で npm ci すると不要な依存がすべてインストールされる
2. Prisma のバイナリ生成がモノレポでの共有を困難にしている。Drizzle に移行すれば pure TypeScript で解決する
3. Aurora Serverless v2 は VPC 必須・コールドスタート・最小課金の問題がある。DSQL に移行すれば VPC 不要・真の pay-per-request になる
4. 上記 1〜3 を同時に解決することで、Prisma バイナリ共有の問題に労力をかけずに済む

## ターゲット構成

```
pnpm-workspace.yaml
package.json                    # ルート（scripts, devDependencies のみ）
apps/
  cdk/                          # 現 cdk/
  webapp/                       # 現 webapp/ から jobs/ を除いた Next.js アプリ
  async-job/                    # 現 webapp/src/jobs/async-job-runner.ts + async-job/
packages/
  db/                           # Drizzle スキーマ・クライアント・マイグレーション SQL・マイグレーションランナー
  shared-types/                 # ジョブペイロード型（JobPayloadProps, スキーマ）
```

### 依存関係の方向

```
apps/webapp       → @repo/shared-types → @repo/db
apps/async-job    → @repo/shared-types → @repo/db
apps/cdk は他パッケージに直接依存しない（Docker ビルドパスのみ参照。マイグレーション Lambda は @repo/db の Dockerfile を参照）
```

アプリ同士は相互に依存しない。内部パッケージのスコープは `@repo/`。

## 方針決定事項

### ORM: Drizzle ORM（Prisma から移行）

- Drizzle ORM をクエリビルダー + 型定義として使用
- drizzle-kit generate は差分 SQL 生成に使えるが、出力は手動で DSQL 互換に修正する必要がある（CREATE INDEX → CREATE INDEX ASYNC 等）
- drizzle-kit push / migrate は使用しない（DSQL の 1DDL/トランザクション制約と衝突）
- Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）だが、node-postgres 経由で動作する
- 参考実装: https://github.com/vercel/aws-dsql-movies-demo

Prisma ではなく Drizzle を選択する理由:
1. `prisma generate` が不要（pure TypeScript）。モノレポでの共有が容易
2. Drizzle の `relations()` は SQL レベルの FK を生成しない。DSQL の FK 非サポートと自然に整合する。Prisma の `@relation` は FK 前提であり、`aurora-dsql-prisma` CLI で FK 文を除去する追加ステップが必要
3. Prisma 7 は Rust → TypeScript へアーキテクチャ移行中で、高並行の小クエリで性能低下が報告されている（Prisma 公式 AMA で認知済み）

### DB: Aurora DSQL（Aurora Serverless v2 から移行）

DSQL の DDL 制約:
- 1トランザクション1DDL
- CREATE INDEX ASYNC 必須
- SERIAL/SEQUENCE 非サポート → UUID を使用
- FOREIGN KEY 非サポート → アプリ層で参照整合性を担保
- JSON/JSONB 非サポート → TEXT で代替
- ALTER COLUMN TYPE / DROP COLUMN 非サポート
- 3,000行/トランザクション上限

### マイグレーション戦略: generate + 自前ランナー

Drizzle 公式ドキュメントの「Option 5」（生成だけして適用は外部ツール）に該当。Vercel 公式デモ（aws-dsql-movies-demo）と同じアプローチ。

参考文献:
- Drizzle Migrations Option 5: https://orm.drizzle.team/docs/migrations
- Vercel DSQL デモ migrate.ts: https://github.com/vercel/aws-dsql-movies-demo/blob/main/lib/db/migrate.ts
- aurora-dsql-prisma-tools transform.ts: https://github.com/awslabs/aurora-dsql-orms/tree/main/node/prisma（SQL 変換ロジックの参考）
- DSQL DDL 制約: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html
- 調査ノート: ~/obsidian/work/dev/drizzle-dsql-migration-strategy.md

### ローカル開発環境

compose.yaml の PostgreSQL を廃止し、開発用 DSQL クラスタを使用する。DSQL にはローカルエミュレータがなく、PostgreSQL との機能乖離が大きいため。

`scripts/dsql.sh create` / `scripts/dsql.sh delete` のサブコマンド式で提供。

### Linter / Formatter: oxlint + oxfmt

プロジェクト全体で ESLint + Prettier を oxlint + oxfmt に置き換える。

### sendEvent の配置

`apps/async-job` にコピーする。shared-types は型のみに限定する。

## migration-runner の設計

### 責務の分離

3 つの責務を明確に分離する。各層は隣接する層だけに依存し、飛び越えた依存を持たない。

1. **マイグレーションコアロジック**（`packages/db/src/migrate.ts`, `check-dsql-compat.ts`）
   - `pg.Pool` を受け取り、SQL ファイルを 1 文ずつ BEGIN/COMMIT で実行する
   - drizzle-kit 出力の DSQL 自動変換（statement-breakpoint → 空行、INDEX → ASYNC、FK 除去）
   - CDK にも Drizzle にも依存しない。ORM に関わらず使える汎用層
   - 将来的に独立パッケージとして切り出し可能な境界

2. **Lambda ハンドラー**（`apps/cdk/lib/constructs/dsql-migrator/handler.ts`）
   - コアロジックの `migrate()` を呼ぶ薄いラッパー。Lambda イベントを受けて Pool を生成し、結果を返すだけ
   - CDK Construct と 1:1 で対応するが、ロジックは持たない

3. **CDK Construct**（`apps/cdk/lib/constructs/dsql-migrator/index.ts`）
   - DockerImageFunction + CDK Trigger でデプロイ時自動実行を構成する
   - Database Construct から endpoint と IAM 権限を受け取る
   - マイグレーションの中身には関与しない

この分離により:
- コアロジックは Drizzle 以外の ORM（Prisma、手書き SQL）でも利用可能
- Lambda ハンドラーは CDK 以外のデプロイツール（Terraform、SAM）でも利用可能
- CDK Construct はマイグレーション SQL の生成方法に依存しない

### 配置

`packages/db` にコアロジック・CLI・マイグレーション SQL を同居させる。スキーマ定義とマイグレーションが同一パッケージに閉じ、`pnpm --filter @repo/db run migrate` でローカル実行可能。

```
packages/db/
  src/
    schema.ts               # Drizzle スキーマ定義
    client.ts               # DSQL クライアント（IAM 認証）
    migrate.ts              # マイグレーションコアロジック（Pool を受け取る、環境非依存）
    check-dsql-compat.ts    # drizzle-kit 出力の DSQL 自動変換 + バリデーション
    cli.ts                  # CLI エントリポイント（cli.ts → migrate.ts）
  drizzle.config.ts         # drizzle-kit 設定（generate 用、DB 接続不要）
  migrations/               # SQL ファイル + meta/ (drizzle-kit snapshot)
  package.json              # scripts: { "generate": "...", "migrate": "..." }
```

CDK 側は `apps/cdk/lib/constructs/dsql-migrator/` に Lambda ハンドラー（handler.ts）と Construct を配置。handler.ts は `@repo/db` の migrate() を import する薄いラッパー。現行の `event-bus/handler.mjs` と同じパターン。将来的に独立 Construct として切り出す余地を残す。

### 要件

- Lambda ハンドラーとローカル CLI の両方で実行可能
- CDK Trigger で cdk deploy 時に自動実行（現行の prisma db push と同じ UX）
- ローカルからは `pnpm --filter @repo/db run migrate` で実行

### コアロジック（migrate.ts）の仕様

Vercel デモ（lib/db/migrate.ts）を参考に、以下の改善を加える:

1. `_migrations` テーブルで適用状態を管理（name, hash, executed_at）
   - Vercel デモは name のみだが、hash を追加してファイル改竄を検知する
2. `@repo/db` の `migrations/` ディレクトリから .sql ファイルをソート順に読み込み
3. 各 SQL ファイルを空行（`\n\n`）で分割し、1 文ずつ BEGIN/COMMIT で実行
   - Vercel デモと同じ分割方式。DSQL の 1DDL/トランザクション制約に対応
4. `already exists` エラーは冪等性のためスキップ（Vercel デモと同じ）
5. DSQL 非互換 SQL の実行時検知:
   - `CREATE INDEX` に `ASYNC` がない場合はエラー
   - `REFERENCES` / `FOREIGN KEY` を含む文はエラー
   - `ALTER COLUMN TYPE` / `DROP COLUMN` を含む文はエラー

### DSQL 接続パターン

- `@aws-sdk/dsql-signer` で IAM 認証トークンを生成し、node-postgres に渡す
- Lambda: 実行ロールの IAM 認証を使用
- ローカル CLI: AWS プロファイルの認証情報を使用
- 参考: https://github.com/awslabs/aurora-dsql-connectors/tree/main/node/node-postgres/

### マイグレーション SQL ファイルの規約

Vercel デモの SQL ファイル形式に準拠:
- 各ステートメントは空行で区切る（ランナーが `\n\n` で分割するため）
- `CREATE INDEX` は必ず `CREATE INDEX ASYNC` にする
- `IF NOT EXISTS` を付与して冪等性を確保
- FK 制約は含めない（Drizzle スキーマの `relations()` はクエリビルダー用であり SQL には反映しない）

### CDK 統合

現行の `webapp.ts` にある MigrationRunner の構造を踏襲:
- `DockerImageFunction` で Lambda を作成（ビルドコンテキストはリポジトリルート）
- CDK Trigger で deploy 時に自動実行
- `MigrationCommand` を CfnOutput で出力（手動実行用）
- VPC 不要（DSQL はパブリックエンドポイント）
- handler.ts と Dockerfile は `apps/cdk/lib/constructs/dsql-migrator/` に配置（現行の `event-bus/handler.mjs` と同じパターン）。コアロジック（migrate.ts）は `@repo/db` から import する

## DSQL 非互換コードの検知戦略

2 層で検知する:

### 層 1: oxlint（Drizzle スキーマ定義レベル）

`eslint/no-restricted-imports` と `eslint/no-restricted-syntax` で検知:
- `drizzle-orm/pg-core` から `serial`, `smallserial`, `bigserial`, `json`, `jsonb` の import を禁止
- `.references()` メソッド呼び出しを禁止（スキーマファイル限定）

oxlint はこれらのルールを実装済み: https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports

### 層 2: migration-runner（生成 SQL レベル）

migration-runner が SQL 適用前にバリデーション:
- `CREATE INDEX` に `ASYNC` がない
- `REFERENCES` / `FOREIGN KEY` を含む
- `ALTER COLUMN TYPE` / `DROP COLUMN` を含む

## 要調査事項

### 1. DSQL + Drizzle の接続パターン

確認すべき点:
- Lambda 環境での接続プーリング（Lambda 実行コンテキスト間でのコネクション再利用）
- Next.js の hot reload 時のコネクションリーク防止（現行の `globalForPrisma` パターンに相当するもの）
- IAM トークンの有効期限とリフレッシュ戦略
- OCC リトライ戦略: DSQL は Optimistic Concurrency Control を使用し、write conflict 時にトランザクションが abort される。アプリ層でのリトライロジックが必要
- ネットワーク一時障害のリトライ: 接続断等の一時的エラーと認証失敗等の永続的エラーを区別するリトライ戦略が必要（issue #91 コメントで指摘）

### 2. Drizzle スキーマの DSQL 互換性

- `@updatedAt` → Drizzle には自動更新がない。アプリ層で `new Date()` を設定するか、`.$onUpdate(() => new Date())` を使用
- `TodoItemStatus` enum → DSQL が PostgreSQL enum をサポートするか確認が必要。非サポートなら TEXT + Zod で代替
- Vercel デモでは `.references()` を使っているが、マイグレーション SQL では FK を含めていない。Drizzle の `relations()` API でリレーション定義し、SQL レベルの FK は生成しない方針が正しい
- `.references()` を oxlint で禁止すると Drizzle の型推論に影響する可能性がある。`relations()` のみで型安全な join が可能か確認が必要

### 3. Zod スキーマの生成元

現行は `zod-prisma-types` が Prisma スキーマから Zod を自動生成。Drizzle 移行後の選択肢:
- `drizzle-zod` で insert/select スキーマを生成
- 手書き（現行の `schemas.ts` は既に手書き）
- 現行コードで実際に Prisma 生成 Zod がどこで使われているか確認が必要。`actions.ts` の入力スキーマは手書きの `schemas.ts` を使っており、Prisma 生成 Zod への依存は限定的な可能性がある

### 4. CDK の DSQL リソース定義

- `aws-cdk-lib` に DSQL の L2 コンストラクトがあるか確認（なければ L1 `CfnCluster` を使用）
- IAM 認証のポリシー設定

### 5. oxfmt の成熟度

oxfmt が Prettier の代替として十分か確認。未成熟なら Prettier を残す選択肢もある。

### 6. DSQL のリージョン制約

DSQL が利用可能なリージョンが限定されている可能性。現行は `CDK_DEFAULT_REGION` で任意リージョンにデプロイ可能。DSQL 非対応リージョンへのデプロイが失敗するリスクがある。対応リージョンを README に明記するか、CDK で検証する必要がある。

### 7. UsEast1Stack の扱い

現行の `us-east-1-stack.ts` は CloudFront 用 ACM 証明書と Lambda@Edge を作成。DSQL 移行で VPC は消えるが、CloudFront + Lambda Function URL の構成は変わらないため UsEast1Stack は残る。

## リスク

> **実装時の追加知見（2026-03-20）**
>
> - `shamefully-hoist=true` は不要。不足していた暗黙的依存を明示的に `devDependencies` に追加することで解決。
> - Docker ビルドでは `pnpm install --filter` が workspace 依存の推移的 dependencies をホイストしないため、`--filter` なしの `pnpm install --frozen-lockfile` を使用。
> - CDK の `DockerImageCode.fromImageAsset` にはモノレポルートの `.dockerignore` を読ませるため `ignoreMode: IgnoreMode.DOCKER` が必須。
> - esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要。
> - `--external:@aws-sdk/*` は `@aws/aurora-dsql-node-postgres-connector` を除外しない（`@aws/*` ≠ `@aws-sdk/*`）。Lambda ランタイムは `@aws-sdk/*` のみ提供。

### Drizzle の DSQL 正式サポートが遅延するリスク

drizzle-team/drizzle-orm#5248 は open のまま。node-postgres 経由で動作するが、drizzle-kit generate が DSQL 固有の制約を考慮しない。

緩和策: oxlint でスキーマ定義を検証 + migration-runner で生成 SQL をバリデーション。

### DSQL の PostgreSQL enum サポート

現行スキーマの `TodoItemStatus` enum が DSQL で使えるか未確認。

### マイグレーションガイドの品質

AI agent が自律的に移行計画を立てられるだけの情報量が必要。実際に agent に食わせてテストすべき。

## タスク

タスクは番号順に実行する。

### 1. ルート設定とパッケージマネージャ移行

pnpm-workspace.yaml、ルート package.json、.npmrc を作成。package-lock.json を削除。

ゴール: `pnpm install` が exit 0

### 2. oxlint / oxfmt の導入

ESLint + Prettier を oxlint + oxfmt に置き換え。Next.js ルールは oxlint の `nextjs` プラグイン（`@next/eslint-plugin-next` 互換）で対応。DSQL 非互換パターンの `no-restricted-imports` ルールを設定。

ゴール: `pnpm run lint` が exit 0。eslint, prettier, eslint-config-next への依存がどの package.json にもない

### 3. 開発用 DSQL クラスタのセットアップスクリプト

`scripts/dsql.sh create` / `scripts/dsql.sh delete` を作成。クラスタ作成 + `packages/db/.env` 生成。compose.yaml を削除。

ゴール: `bash scripts/dsql.sh --help` が exit 0

### 4. packages/db の作成（Drizzle + DSQL + マイグレーションランナー）

Drizzle スキーマ定義、DSQL クライアント、初期マイグレーション SQL、マイグレーションランナー（コアロジック + CLI）を配置。現行 Prisma スキーマを Drizzle スキーマに変換。

現行 Prisma スキーマとの同等性の定義: User テーブル（id: string PK）と TodoItem テーブル（id: uuid PK, title: text, description: text, userId: string, status: text, createdAt: timestamp, updatedAt: timestamp）が Drizzle スキーマに定義されていること。TodoItemStatus enum は TEXT に変更。

ゴール:
- `pnpm --filter @repo/db exec tsc --noEmit` が exit 0
- `pnpm run lint --filter @repo/db` が exit 0（DSQL 非互換ルールを通過）

### 5. packages/shared-types の作成

ゴール: `pnpm --filter @repo/shared-types exec tsc --noEmit` が exit 0

### 6. apps/webapp のリファクタ

webapp/ を apps/webapp/ に移動。Prisma → Drizzle に変更。`@repo/db` と `@repo/shared-types` への依存を追加。`src/jobs/` を削除。

.env.local.example の DSQL 対応版:
```
DSQL_ENDPOINT=<your-cluster>.dsql.<region>.on.aws
AWS_REGION=us-east-1
COGNITO_DOMAIN=auth.example.com
AMPLIFY_APP_ORIGIN=http://localhost:3010
USER_POOL_CLIENT_ID=dummy
USER_POOL_ID=us-east-1_dummy
NEXT_PUBLIC_EVENT_HTTP_ENDPOINT=""
NEXT_PUBLIC_AWS_REGION="us-east-1"
ASYNC_JOB_HANDLER_ARN=""
```

ゴール: `cp apps/webapp/.env.local.example apps/webapp/.env.local && pnpm --filter webapp run build` が exit 0

### 7. apps/async-job の作成

ゴール: `pnpm --filter async-job exec tsc --noEmit` が exit 0

### 8. apps/cdk の更新（DSQL + VPC 廃止）

Aurora Serverless v2 → DSQL に変更。VPC / NAT Instance / BastionHost を削除。Docker ビルドパスを各 app に変更。`dsql-migrator` Construct を作成（handler.ts + Construct）し、`@repo/db` の migrate() を呼ぶ Lambda + CDK Trigger で統合。

ゴール:
- `pnpm --filter @aws-samples/serverless-fullstack-webapp-starter-kit run build` が exit 0
- `pnpm --filter @aws-samples/serverless-fullstack-webapp-starter-kit run test -- -u` が exit 0

### 9. CI/CD の更新

GitHub Actions を pnpm + oxlint 対応に変更。

ゴール: build.yml に npm への参照がない

### 10. ドキュメント更新

README.md、AGENTS.md を pnpm + DSQL + Drizzle に更新。

ゴール: README.md, AGENTS.md に npm コマンドへの参照がない

### 11. マイグレーションガイドの作成

`.serverless-full-stack-webapp-starter-kit/docs/migration/v3-pnpm-workspaces-prompt.md` を作成。

ゴール: ファイルが存在し、Prisma→Drizzle、Aurora Serverless v2→DSQL、VPC 廃止の要点が含まれている

### 12. 最終検証

静的チェック（lint, build, tsc）だけでは不十分。ESM モジュールの即時評価、環境変数の読み込み、Docker 内のパス解決、Lambda ランタイムの挙動など、ビルドが通っても実行時にクラッシュする問題が多い。以下の順序で段階的に検証する。各段階で問題を発見・修正してから次に進むこと。

#### 12a. 静的チェック

```bash
pnpm install
pnpm -r exec tsc --noEmit
pnpm run lint
```

確認事項:
- `webapp/` と `cdk/` ディレクトリ（旧パス）が存在しないこと
- prisma, eslint への依存がどの package.json にもないこと

#### 12b. ビルド

```bash
cp apps/webapp/.env.local.example apps/webapp/.env.local
pnpm --filter webapp run build
pnpm --filter @repo/cdk run build
pnpm --filter @repo/cdk run test
```

#### 12c. ローカル Docker イメージビルド

Dockerfile が正しく動作するか、CDK を通さずに直接確認する。pnpm workspaces + Docker の組み合わせは罠が多い（`--filter` の推移的依存、`.dockerignore` の読み込み、esbuild の外部パッケージ解決）。

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

#### 12d. ローカルマイグレーション実行

実際の DSQL クラスタに対してマイグレーションを実行する。ビルドが通っても、ESM モジュールの即時評価や `.env` の読み込みでクラッシュする可能性がある。

```bash
bash scripts/dsql.sh create --region <region>
pnpm --filter @repo/db run migrate
```

確認事項:
- `packages/db/.env` が生成され、`DSQL_ENDPOINT` と `AWS_REGION` が設定されていること
- マイグレーションが成功し、`_migrations` テーブルにレコードが挿入されること
- 再実行で冪等（既に適用済みのマイグレーションがスキップされること）

#### 12e. ローカルデバッグサーバー + ブラウザ e2e

`apps/webapp/.env.local` に実際の Cognito / DSQL / AppSync の値を設定し、`pnpm run dev` でローカルサーバーを起動してブラウザで操作する。

```bash
# .env.local に実際の値を設定（Cognito は既存スタックの出力から取得）
cd apps/webapp && pnpm run dev
```

確認事項:
- サインインページが表示されること
- Cognito Managed Login でログインできること
- Todo の CRUD（作成・完了・編集・削除）が動作すること
- DB からのデータ読み込みが正しいこと

#### 12f. cdk deploy

```bash
cd apps/cdk && pnpm exec cdk deploy --all
```

v2 スタックが存在する場合は UPDATE になる。以下の既知の問題に注意:

- **VPC ENI 残存**: VPC Lambda → 非VPC Lambda への移行時、Hyperplane ENI が最大20分 `available` 状態で残り、セキュリティグループとサブネットの削除がブロックされる。`DELETE_FAILED` が出たら手動で ENI → SG の順に削除する（詳細はマイグレーションガイド参照）

確認事項:
- 両スタック（UsEast1Stack, MainStack）が `UPDATE_COMPLETE` / `CREATE_COMPLETE` になること
- `MigrationCommand` の出力が DsqlMigrator を指していること
- `DatabaseClusterEndpoint` の出力が DSQL エンドポイントであること

#### 12g. デプロイ後 e2e

デプロイされた CloudFront URL にブラウザでアクセスし、全機能を確認する。

確認事項:
- サインイン → Todo 作成 → 完了 → 削除が動作すること
- **Translate（非同期ジョブ）**: ボタン押下 → Lambda 非同期実行 → AppSync Events でリアルタイム通知 → ページ自動更新で翻訳結果が表示されること
- サインアウトが動作すること

#### 12h. Lambda マイグレーション実行

```bash
aws lambda invoke --function-name <MigrationFunctionName> --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout
```

確認事項:
- `{"statusCode":200,"body":"Migration complete"}` が返ること
- 再実行で冪等であること（既に適用済みのマイグレーションがスキップされること）

## 実装後の検証で発見した問題（2026-03-20）

### ESM モジュール即時評価による cli.ts クラッシュ

`client.ts` で `export const db = drizzle({ client: getPool(), schema })` がモジュール読み込み時に即座に実行される。`cli.ts` が `import { getPool } from './client'` しただけで `db` の初期化も走り、`DSQL_ENDPOINT` 未設定時にクラッシュ。

対策: `db` を Proxy で遅延初期化に変更。`import { db }` の既存コードを壊さずに、実際のプロパティアクセス時まで初期化を遅延させる。

### tsx は .env を自動ロードしない

`"migrate": "tsx src/cli.ts"` では `packages/db/.env` が読まれない。`tsx --env-file=.env src/cli.ts` に変更。

### v2→v3 アップデート時の VPC ENI 残存

Lambda が VPC から外れた後、Hyperplane ENI が `available` 状態で最大20分残存し、セキュリティグループとサブネットの CloudFormation 削除が `DELETE_FAILED` になる。手動で ENI → SG の順に削除が必要。マイグレーションガイドに手順を記載済み。

### 教訓: 静的検証だけでは不十分

タスク12の `tsc --noEmit` と `pnpm run build` は全て通っていたが、実際のランタイム実行（`pnpm --filter @repo/db run migrate`）で即座にクラッシュした。モジュール初期化順序や環境変数の読み込みは型チェック・ビルドでは検出できない。実環境での動作確認が不可欠。
