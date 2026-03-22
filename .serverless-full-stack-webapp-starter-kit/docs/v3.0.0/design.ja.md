# v3.0.0 設計ドキュメント

## 概要

v3 では DB エンジン（Aurora Serverless v2 → Aurora DSQL）、ORM（Prisma → Drizzle）、パッケージマネージャ（npm → pnpm workspaces）、リンター（ESLint + Prettier → oxlint + oxfmt）を同時に変更する。これら4つの変更は相互に依存しており、同時に解決することで中間状態への無駄な労力（例: どうせ置き換える Prisma をモノレポ対応させる作業）を回避する。

## 動機

v2 には3つの構造的問題があった:

1. **コードの同居**: `webapp/` に Next.js・非同期ジョブ・マイグレーションランナーが同居。async-job の Dockerfile で `npm ci` すると不要な依存がすべてインストールされ、イメージサイズとビルド時間が膨張する。
2. **Prisma バイナリのオーバーヘッド**: `prisma generate` がプラットフォーム固有のバイナリを生成し、モノレポでの共有を困難にする。Prisma クライアントを import するパッケージごとに generate が必要。
3. **VPC 必須**: Aurora Serverless v2 は Lambda アクセスに VPC + NAT（Instance or Gateway）が必要。月額 ~$30 のベースコストと運用の複雑さ（セキュリティグループ、サブネット、ENI ライフサイクル）はスターターキットには不釣り合い。

(1) だけ解決（モノレポ化）すると Prisma のバイナリ共有問題を解く必要があるが、Drizzle に移行すれば無駄になる。(2) だけ解決（Drizzle 移行）しても VPC コストは残る。3つ同時に解決 — モノレポ + Drizzle + DSQL — すれば、中間的な無駄なく各問題を排除できる。

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

## 主要な設計判断

### Aurora DSQL

意図: VPC の排除、真の従量課金、認証の簡素化。

DSQL は VPC 不要 — Lambda はパブリックインターネット経由で IAM 認証接続する。NAT Instance のコスト、セキュリティグループ管理、VPC 接続 Lambda を悩ませる ENI ライフサイクル問題を排除。従量課金（read/write RPU）によりトラフィックゼロ時のコストもゼロ。Aurora Serverless v2 の最小 0.5 ACU（~$43/月）とは対照的。

受容したトレードオフ: DSQL には重大な DDL 制約がある（1トランザクション1DDL、FK なし、SERIAL なし、JSON/JSONB なし、ALTER TABLE 制限）。これらの制約はスタック全体 — スキーマ設計、ORM 選択、マイグレーションツール、リントルール — に波及する。

### Drizzle ORM

意図: DSQL の制約に自然に適合する純粋 TypeScript ORM。

Prisma ではなく Drizzle を選択した理由は3つ:

1. **コード生成不要**: Drizzle は純粋 TypeScript — `prisma generate` もプラットフォーム固有バイナリも不要。スキーマ定義は通常の TypeScript ファイルで、ビルドステップなしにモノレポ内のパッケージ間で import 可能。
2. **`relations()` が DSQL の FK なし制約に適合**: Drizzle の `relations()` API はクエリビルダー用のリレーションを定義するが、SQL レベルの外部キーは生成しない。Prisma の `@relation` は FK サポートを前提としており、DSQL で使うには `aurora-dsql-prisma-tools` で FK 文を除去する追加ステップが必要。
3. **Prisma 7 の不確実性**: Prisma 7 は Rust → TypeScript へのアーキテクチャ移行中で、高並行の小クエリで性能低下が報告されている。Drizzle を採用することでこのリスクを回避。

Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）だが、node-postgres 経由で動作する。リスクは2層の DSQL 互換性チェック（oxlint + SQL バリデーション）で緩和。

### カスタムマイグレーションランナー

意図: 移植性とテスタビリティのための3層分離（コアロジック / Lambda ハンドラー / CDK Construct）。

`drizzle-kit migrate` は全未適用マイグレーションを単一トランザクションで実行する — DSQL の1DDL/トランザクション制約と根本的に非互換。`drizzle-kit push` は DSQL 制約を完全に無視する。これは Drizzle 公式ドキュメントの「Option 5」: drizzle-kit で SQL を生成し、外部ツールで適用する方式。

ランナーは SQL ファイルを空行（`\n\n`）で分割し、各文を個別の `BEGIN`/`COMMIT` で実行する。`_migrations` テーブルで適用済みマイグレーションを名前で追跡。`already exists` エラーは冪等性のためスキップ。

3層設計:

- **コアロジック**（`packages/db/src/migrate.ts`）: `pg.Pool` を受け取り、SQL ファイルを読み込み実行。CDK・Lambda・Drizzle への依存なし。任意の ORM やデプロイツールで再利用可能。
- **Lambda ハンドラー**（`apps/cdk/lib/constructs/dsql-migrator/handler.ts`）: Lambda 環境変数から Pool を生成し `migrate()` を呼ぶ薄いラッパー。
- **CDK Construct**（`apps/cdk/lib/constructs/dsql-migrator/index.ts`）: `DockerImageFunction` + CDK Trigger で `cdk deploy` 時に自動実行。

### DSQL 互換性戦略

意図: DSQL 非互換パターンをコーディング時とマイグレーション時の2段階で検出。

**第1層 — oxlint（スキーマ定義レベル）**: `no-restricted-imports` で `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial`, `json`, `jsonb` の import をブロック。エディタと CI で即座にフィードバック。（`.references()` 用の `no-restricted-syntax` は設定済みだが oxlint v1.56.0 時点で未動作。）

**第2層 — SQL バリデーション（生成 SQL レベル）**: `check-dsql-compat.ts` が drizzle-kit 出力を自動変換（statement-breakpoint → 空行、`CREATE INDEX` → `CREATE INDEX ASYNC`、FK 除去）し、自動修正不可能なパターン（`ALTER COLUMN TYPE`、`DROP COLUMN`、`SET/DROP NOT NULL`、`SET/DROP DEFAULT`、`DROP CONSTRAINT`、`SERIAL`、`TRUNCATE`）を検証。修正不可能なパターンはエラーを出力し、`drizzle-kit generate --custom` でのテーブル再作成手順を案内。

### pnpm workspaces

意図: `shamefully-hoist` なしの厳格な依存関係分離。

pnpm の strict モードは各パッケージが宣言した依存関係のみにアクセスすることを保証。npm のフラットな `node_modules` が暗黙的に解決してしまう未宣言の依存を検出する。

strict モードでの Docker ビルド制約:
- `pnpm install --filter` は workspace パッケージの推移的依存をホイストしない。Dockerfile では `--filter` なしの `pnpm install --frozen-lockfile` を使用。
- CDK の `DockerImageCode.fromImageAsset` はデフォルトで `.dockerignore` を読まない。`cdk.out` の再帰コピーを防ぐため、すべての Docker アセットに `ignoreMode: IgnoreMode.DOCKER` が必須。
- esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要（Node.js ランタイムのデフォルトは CommonJS）。
- `--external:@aws-sdk/*` は `@aws/aurora-dsql-node-postgres-connector` のような `@aws/*` パッケージを除外しない。

### oxlint + oxfmt

意図: DSQL 固有ルールを備えた高速リンティング。

oxlint は DSQL 互換性チェックに必要な `no-restricted-imports` ルールを、ESLint より大幅に高速に実行。oxfmt は Prettier の代替としてフォーマッティングを担当。

制限: `no-restricted-syntax` は oxlint v1.56.0 時点で未サポート。`.references()` 呼び出し制限は `oxlintrc.json` に設定済みだが、oxlint がサポートするまで無効。`check-dsql-compat.ts` の SQL レベルバリデーションがフォールバック。

## 既知の制約とトレードオフ

- **DSQL DDL 制約**: 1トランザクション1DDL、FK なし、SERIAL/SEQUENCE なし（IDENTITY を使用）、JSON/JSONB なし（TEXT を使用）、`CREATE INDEX ASYNC` のみ、ALTER TABLE 制限（ADD COLUMN, RENAME, identity 操作のみ）、書き込みトランザクションあたり3,000行、TRUNCATE なし、トリガーなし、PL/pgSQL なし。
- **Drizzle DSQL サポート**: 正式リリース未済（drizzle-team/drizzle-orm#5248）。node-postgres 経由で動作。drizzle-kit generate は DSQL 制約を考慮しない — 出力には自動変換とバリデーションが必要。
- **oxlint `no-restricted-syntax`**: v1.56.0 時点で未サポート。`.references()` 検出は oxlint がこのルールを追加するまで SQL レベルバリデーションに依存。
- **DSQL リージョン制限**: DSQL は全 AWS リージョンで利用可能ではない。サポートされたリージョンにデプロイする必要がある。
- **ESM 即時評価**: `client.ts` は Proxy ベースの遅延初期化を使用し、モジュール読み込み時に `db` が初期化されることを防止。これがないと同じモジュールから import する CLI ツールがクラッシュする。
