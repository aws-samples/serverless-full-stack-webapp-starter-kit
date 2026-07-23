# ADR-002: pnpm workspaces モノレポ

## ステータス

採択（v3.0.0）

## コンテキスト

v2 では `webapp/` に Next.js・非同期ジョブ・マイグレーションランナーが単一パッケージに同居。`job.Dockerfile` は分かれていたが `package.json` が1つのため、`npm ci` で webapp の全依存（React, Next.js, aws-amplify 等）がインストールされ、イメージサイズとビルド時間が膨張。

非同期ジョブと DB コードを別パッケージに抽出するにはモノレポツールが必要。パッケージマネージャの選択は Docker ビルドの挙動、依存解決の厳格さ、CI パフォーマンスにも影響する。

## 決定

pnpm workspaces を strict モード（`shamefully-hoist` なし）で使用。

```
apps/           # デプロイ可能なアプリケーション（webapp, async-job, cdk）
packages/       # 共有ライブラリ（db, shared-types）
```

内部パッケージは `@repo/` スコープ。アプリ同士は相互に依存しない。

### 却下した代替案

- *npm workspaces*: フラットな `node_modules` が未宣言の依存を暗黙的に解決し、Docker ビルドで壊れる未宣言依存を隠蔽する。pnpm の strict モードはインストール時にこれを検出。
- *Turborepo + pnpm*: タスクオーケストレーションとキャッシュを追加するが、キットの workspace は現時点で7つという少数で、依存チェーンもシンプル。この規模では Turborepo 設定のオーバーヘッドは正当化されない。必要になればユーザーが後から追加可能。

## 結果

- **Docker `--filter` の制限**: pnpm のデフォルトの isolated `node_modules` は、各パッケージが宣言した依存関係のみを公開する（この厳格さは意図的）。バンドラーはディスク上の完全な推移的依存グラフを解決する必要があるため、Dockerfile では `--filter` でインストール範囲を絞るのではなく、`--filter` なしの `pnpm install --frozen-lockfile` で workspace 全体の依存関係をインストールする。
- **`.dockerignore` + `ignoreMode`**: CDK の Docker image asset は `.dockerignore` を読み、`cdk.out` を自動的に除外するが、デフォルトでは除外パターンを Docker ではなく GLOB セマンティクスで解釈する。リポジトリ root を build context とする場合、パターンが実際の `docker build` と一致し、深い pnpm `node_modules` ツリーが staging されないよう、全 Docker asset に `ignoreMode: IgnoreMode.DOCKER` を設定する（そうしないと staging が `ENAMETOOLONG` などで失敗する可能性がある）。これは `ContainerImageBuild` と `DockerImageAsset` の両方に適用。
- **ESM + Lambda**: esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要。Node.js ランタイムは `.mjs` または `package.json` の `"type": "module"` がないと CommonJS として読み込む。
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` は `@aws/aurora-dsql-node-postgres-connector` を除外しない。Lambda ランタイムは `@aws-sdk/*` のみ提供。他の `@aws/*` パッケージはバンドルが必要。
