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
- *Turborepo + pnpm*: タスクオーケストレーションとキャッシュを追加するが、キットは5パッケージのみでシンプルな依存チェーン。この規模では Turborepo 設定のオーバーヘッドは正当化されない。必要になればユーザーが後から追加可能。

## 結果

- **Docker `--filter` の制限**: `pnpm install --filter` は strict モードで workspace パッケージの推移的依存をホイストしない。Dockerfile では `--filter` なしの `pnpm install --frozen-lockfile` で全 workspace 依存をインストールする必要がある。
- **`.dockerignore` + `ignoreMode`**: CDK の `DockerImageCode.fromImageAsset` はデフォルトで `.dockerignore` を読まない。`cdk.out` の再帰コピー（`ENAMETOOLONG`）を防ぐため、すべての Docker アセットに `ignoreMode: IgnoreMode.DOCKER` が必須。
- **ESM + Lambda**: esbuild `--format=esm` の出力は Lambda で `.mjs` 拡張子が必要。Node.js ランタイムは `.mjs` または `package.json` の `"type": "module"` がないと CommonJS として読み込む。
- **`@aws/*` ≠ `@aws-sdk/*`**: `--external:@aws-sdk/*` は `@aws/aurora-dsql-node-postgres-connector` を除外しない。Lambda ランタイムは `@aws-sdk/*` のみ提供。他の `@aws/*` パッケージはバンドルが必要。
