# v3.0.0 アーキテクチャ決定記録

## ADR-001: Aurora DSQL + Drizzle ORM + カスタムマイグレーションランナー

### ステータス

採択（v3.0.0）

### コンテキスト

v2 のアーキテクチャには3つの複合的な問題があった:

1. **VPC のコストと複雑さ**: Aurora Serverless v2 は Lambda アクセスに VPC + NAT（Instance or Gateway）が必要。NAT Instance だけで月額 ~$30 — 月額 $10 未満を目指すスターターキットには不釣り合い。VPC はさらに運用オーバーヘッドを生む: セキュリティグループ、サブネット、デプロイ変更時の Lambda Hyperplane ENI ライフサイクル問題。
2. **Prisma バイナリのオーバーヘッド**: `prisma generate` がプラットフォーム固有のクエリエンジンバイナリを生成。モノレポでは Prisma クライアントを import するパッケージごとに generate が必要。バイナリは Docker イメージを肥大化させ、クロスプラットフォームビルドを複雑にする。
3. **モノレポ共有の摩擦**: Prisma のバイナリ生成と Aurora の VPC 要件がある状態で、共有 DB コードをモノレポパッケージに抽出するには両方の問題を同時に解決する必要がある — さもなければ捨てることになる作業を受け入れるしかない。

これら3つの問題は依存チェーンを形成する: モノレポ構造の解決(1)には Prisma 共有の解決(2)が必要で、最もインパクトの大きい改善 — VPC コストの排除(3) — には DB エンジンの変更が必要であり、それにより ORM の選択も変わる。3つ同時に解決することで中間的な無駄を回避。

### 決定

**データベース: Aurora DSQL** — VPC 不要のサーバーレス分散 SQL データベース。Lambda はパブリックインターネット経由で IAM 認証接続。真の従量課金（read/write RPU）でトラフィックゼロ時のコストもゼロ。

**ORM: Drizzle ORM** — コード生成ステップのない純粋 TypeScript ORM。`relations()` は SQL レベルの外部キーを生成せずにクエリビルダー用のリレーションを定義し、DSQL の FK なし制約に自然に適合。スキーマファイルは通常の TypeScript でモノレポ内のパッケージ間で import 可能。

**マイグレーションランナー: カスタム実装** — drizzle-kit 組み込みのマイグレーションツールは DSQL と非互換:
- `drizzle-kit migrate` は全未適用マイグレーションを単一トランザクションで実行し、DSQL の1DDL/トランザクション制約に違反。
- `drizzle-kit push` は DSQL 制約を完全に無視。

カスタムランナーは Drizzle 公式ドキュメントの「Option 5」（drizzle-kit で SQL 生成、外部ツールで適用）に従い、Vercel の aws-dsql-movies-demo と同じアプローチ。SQL を空行で分割し、各文を個別トランザクションで実行、`_migrations` テーブルで状態を追跡。

ランナーは移植性のため3層構造:
- コアロジック（`packages/db/src/migrate.ts`）: `pg.Pool` を受け取る。フレームワーク依存なし
- Lambda ハンドラー: CDK Trigger 実行用の薄いラッパー
- CDK Construct: `DockerImageFunction` + Trigger でデプロイ時自動実行

#### 却下した代替案

**データベース:**
- *Aurora Serverless v2（維持）*: VPC コストと複雑さが残る。スターターキットの価値提案は最小限の運用オーバーヘッド。
- *DynamoDB*: シングルテーブル設計の学習曲線が急。SQL はキットの対象読者（サーバーレス初心者の開発者）にとってよりアクセスしやすい。
- *Neon*: サードパーティ依存。キットは CDK デプロイモデルとの一貫性のため AWS ネイティブサービスを対象とする。

**ORM:**
- *Prisma + aurora-dsql-prisma-tools*: `prisma generate` が必要（バイナリオーバーヘッドが残る）、`@relation` は FK サポートを前提 — aurora-dsql-prisma-tools で生成 SQL から FK 文を除去する必要がある。Prisma 7 の Rust → TypeScript アーキテクチャ移行がさらなる不確実性を生む。
- *Kysely*: 純粋 TypeScript クエリビルダーだが、Drizzle の `relations()` API のような宣言的リレーション定義がない。手動での join 構築が必要。
- *生 SQL*: 型安全性なし。DB から React コンポーネントまでのエンドツーエンド型安全性というキットの目標に反する。

**マイグレーションランナー:**
- *drizzle-kit migrate*: 全マイグレーションを1トランザクションで実行 — DSQL の1DDL/トランザクション制約と根本的に非互換。
- *drizzle-kit push*: DSQL 制約を無視（非 ASYNC インデックス、FK 文などを生成）。
- *Flyway*: JVM 依存。Node.js/TypeScript プロジェクトに運用の複雑さを追加。（Flyway は 2026年2月に DSQL dialect サポートを追加したが、JVM 要件は残る。）

### 結果

- **DDL 制約の波及**: DSQL の制約（FK なし、SERIAL なし、JSON/JSONB なし、ALTER TABLE 制限）がスキーマ設計、リントルール、マイグレーションツールに影響。2層検出戦略（oxlint でスキーマ定義、SQL バリデーションで生成マイグレーション）が必要。
- **マイグレーションランナーの保守**: カスタムランナーは追加の保守対象コード。ただしコアロジックは約200行で、包括的なテスト（unit + integration）を備える。
- **Drizzle DSQL サポートのギャップ**: Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）。drizzle-kit generate は DSQL 制約を考慮しない — 出力には自動変換（`CREATE INDEX` → `CREATE INDEX ASYNC`、FK 除去）とバリデーションが必要。
- **スキーマ変更時のテーブル再作成**: DSQL の限定的な ALTER TABLE サポート（DROP COLUMN なし、ALTER COLUMN TYPE なし、SET/DROP NOT NULL/DEFAULT なし）により、多くのスキーマ変更にはデータ移行を伴うテーブル再作成が必要。ランナーはバッチデータ操作用の `.ts` マイグレーションファイルをサポート。

---

## ADR-002: pnpm workspaces モノレポ

### ステータス

採択（v3.0.0）

### コンテキスト

v2 では `webapp/` に Next.js・非同期ジョブ・マイグレーションランナーが単一パッケージに同居。async-job の Dockerfile は `npm ci` で webapp の全依存（React、Next.js、UI ライブラリ）をインストールしていたが、実際に必要なのはジョブハンドラーと DB 依存のみ。イメージサイズとビルド時間が膨張。

非同期ジョブと DB コードを別パッケージに抽出するにはモノレポツールが必要。パッケージマネージャの選択は Docker ビルドの挙動、依存解決の厳格さ、CI パフォーマンスにも影響する。

### 決定

pnpm workspaces を strict モード（`shamefully-hoist` なし）で使用。モノレポ構造:

```
apps/           # デプロイ可能なアプリケーション（webapp, async-job, cdk）
packages/       # 共有ライブラリ（db, shared-types）
```

内部パッケージは `@repo/` スコープ。アプリ同士は相互に依存しない。

#### 却下した代替案

- *npm workspaces*: フラットな `node_modules` が未宣言の依存を暗黙的に解決し、Docker ビルドで壊れる未宣言依存を隠蔽する。pnpm の strict モードはインストール時にこれを検出。
- *Turborepo + pnpm*: Turborepo はタスクオーケストレーションとキャッシュを追加するが、キットは5パッケージのみでシンプルな依存チェーン。この規模では Turborepo 設定のオーバーヘッドは正当化されない。必要になればユーザーが後から追加可能。

### 結果

- **Docker `--filter` の制限**: `pnpm install --filter` は strict モードで workspace パッケージの推移的依存をホイストしない。Dockerfile では `--filter` なしの `pnpm install --frozen-lockfile` で全 workspace 依存をインストールする必要がある。
- **`.dockerignore` + `ignoreMode`**: CDK の `DockerImageCode.fromImageAsset` はデフォルトで `.dockerignore` を読まない。`cdk.out` の再帰コピー（`ENAMETOOLONG`）を防ぐため、すべての Docker アセットに `ignoreMode: IgnoreMode.DOCKER` が必須。
- **ESM + Lambda**: esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要。Node.js ランタイムは `.mjs` または `package.json` の `"type": "module"` がないと CommonJS として読み込む。
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` は `@aws/aurora-dsql-node-postgres-connector` を除外しない。Lambda ランタイムは `@aws-sdk/*` のみ提供。他の `@aws/*` パッケージはバンドルが必要。

---

## ADR-003: oxlint + oxfmt

### ステータス

採択（v3.0.0）

### コンテキスト

キットにはコーディング時に DSQL 非互換パターンを検出するリントルールが必要 — 具体的には `drizzle-orm/pg-core` からの `serial`, `json`, `jsonb` import をブロックする `no-restricted-imports`。リンター速度は開発者体験と CI 時間に影響し、モノレポの成長に伴い重要性が増す。

### 決定

ESLint + Prettier を oxlint + oxfmt に置き換え。oxlint は必要な `no-restricted-imports` ルールを ESLint より大幅に高速に実行（Rust ベース）。oxfmt は Prettier の代替としてフォーマッティングを担当。

設定済みの DSQL 固有ルール:
- `no-restricted-imports`: `drizzle-orm/pg-core` からの `serial`, `smallserial`, `bigserial`, `json`, `jsonb` をブロック
- `no-restricted-syntax`: スキーマファイルでの `.references()` 呼び出しをブロック（設定済みだが未動作 — 結果を参照）

#### 却下した代替案

- *ESLint + Prettier（維持）*: 実行速度が遅い。ESLint のエコシステムは大きいが、キットが必要とするのはルールの小さなサブセットのみ。速度差は CI とエディタのフィードバックで体感できる。
- *Biome*: Rust ベースのリンター + フォーマッター（単一ツール）。ただし Biome は必要な粒度（モジュールからの特定の名前付き import のブロック）で `no-restricted-imports` をサポートしていない。oxlint の実装は ESLint のルールセマンティクスに一致。

### 結果

- **`no-restricted-syntax` 未サポート**: oxlint v1.56.0 時点で `no-restricted-syntax` は未実装。`.references()` 呼び出し制限は `oxlintrc.json` に設定済みだが無効。oxlint がサポートを追加した時点で自動的に有効化される。それまでは `check-dsql-compat.ts` の SQL レベルバリデーション（生成 SQL 内の `REFERENCES`/`FOREIGN KEY` 検出）がフォールバック。
- **ルールエコシステムの縮小**: oxlint は ESLint より少ないルールをサポート。キットのニーズ（Next.js プラグイン、TypeScript、import 制限）にはカバレッジ十分。追加の ESLint ルールが必要なユーザーは oxlint と並行して ESLint を追加可能。
