# ADR-006: `ContainerImageBuild` によるデプロイ時イメージビルド

## ステータス

採択（v3.0.0）

## コンテキスト

キットは `webapp` と `async-job` の Lambda 用 Docker イメージを構築する。`dsql-migrator` は zip パッケージの NodejsFunction という例外である。
標準的な選択肢は CDK 組み込みの `DockerImageCode.fromImageAsset` — synth 時にローカルの Docker CLI が
イメージをビルドし、ECR にプッシュする — だが、これは以下の課題を持ち込む:

1. **ローカル Docker の必須化**: 開発者マシンと CI ランナーに Docker Desktop / Docker daemon が
   必要になる。Windows での Docker Desktop セットアップは煩雑（WSL2 設定、ライセンス確認）で、
   CI では Docker-in-Docker の構成が必要。キットの Prerequisites を Node.js + pnpm + AWS CLI で
   完結させたい設計方針（README「Getting started」）と衝突する。
2. **アーキテクチャ不整合**: 開発者マシンが x86_64（Intel Mac、Windows）でも Lambda 実行基盤は
   ARM64。`fromImageAsset` はローカル Docker のアーキテクチャに引きずられるため、`--platform`
   指定と emulation（QEMU）が必要で、ビルド時間と信頼性を損なう。

一方、`webapp` は `NEXT_PUBLIC_*` build-time env（Amplify SDK が実行時ではなくビルド時に静的な
値を要求する — 詳細は [design doc](design.ja.md#lambda-環境) を参照）を CDK context から
`buildArgs` として注入する必要がある。この一箇所だけ「synth 時に決まる値をビルド引数として渡す」
仕組みが必要になり、標準の `fromImageAsset` は `buildArgs` を受けるものの、上記 1/2 の課題を
併せ持つ。

## 決定

`webapp` と `async-job` の 2 イメージを **`@cdklabs/deploy-time-build` パッケージの `ContainerImageBuild` construct** で
ビルドする。`DockerImageCode.fromImageAsset` は使用しない。

- 実装: `apps/cdk/lib/constructs/{webapp,async-job}/index.ts` にて
  `new ContainerImageBuild(this, 'Build', { directory: <repo-root>, platform: Platform.LINUX_ARM64,
file: 'apps/*/Dockerfile', ignoreMode: IgnoreMode.DOCKER })` を生成し、
  `image.toLambdaDockerImageCode()` を `DockerImageFunction` に渡す。
- 仕組み: `cdk deploy` 実行時、CloudFormation のカスタムリソースが AWS 側で CodeBuild プロジェクト
  （ARM64, `general1.small`）を起動し、そこでイメージをビルドして ECR にプッシュする。
  同一スタック・同一アーキテクチャの複数の `ContainerImageBuild` は construct 内部の
  `SingletonProject` により 1 つの CodeBuild プロジェクトを共有する。
- `webapp` の `buildArgs`（`ALLOWED_ORIGIN_HOST`、`NEXT_PUBLIC_EVENT_HTTP_ENDPOINT`、
  `NEXT_PUBLIC_AWS_REGION` 等）は従来通り synth 時に埋め込まれ、CodeBuild 側のビルドに
  渡される。
- 前身の `deploy-time-build` パッケージから公式後継である `@cdklabs/deploy-time-build`
  （cdklabs スコープ配下）にも同時に移行した。
- **`dsql-migrator` の例外**: migrator は deploy-time image build ではなく zip パッケージの `NodejsFunction` とする。CloudFormation はこれをデプロイ中に同期呼び出しする一方、container-image version には初期化 window があり、container-only の `CodeArtifactUserPendingException` が発生しうるためである。`webapp` と `async-job` は引き続き deploy-time build の image とする。

### 却下した代替案

- **`DockerImageCode.fromImageAsset`（維持）**: 上記コンテキストの課題（Docker 必須、
  クロスアーキテクチャの emulation）が残る。とくに Windows 環境での初回デプロイ体験を
  阻害する。
- **CI（GitHub Actions 等）で事前にビルドして ECR にプッシュ、CDK は既存イメージを参照**:
  「単一コマンド `pnpm exec cdk deploy --all` でデプロイ完結」というキットの再現性目標
  （DESIGN_PRINCIPLES の Reproducibility）を損なう。デプロイ手順が「push → deploy」の
  2 段になり、CI 未整備の派生アプリでは事前ビルドが手動運用の負担になる。
- **CodeBuild プロジェクトを手書きの CDK コードで定義**: `deploy-time-build` が提供する
  `SingletonProject` によるプロジェクト共有、CloudFormation カスタムリソースとの結線、
  ECR リポジトリ管理を再実装することになり、キットのスコープを超える。

## 結果

- **Prerequisites から Docker が消えた**: README の Prerequisites は Node.js、pnpm、AWS CLI
  のみ。Windows 開発者は WSL2 + Docker Desktop のセットアップなしにデプロイできる。
- **Docker レイヤーキャッシュが効かない（トレードオフ）**: `ContainerImageBuild` は入力
  Asset（`.dockerignore` 適用後のビルドコンテキスト） + `buildArgs` 等が変化した際に
  Custom Resource が Update され CodeBuild で **クリーンな環境からフルビルド** される。
  ローカル Docker ビルドと比べて、`node_modules` インストールや `next build` の
  レイヤー再利用による差分ビルドの高速化は失う（コードを 1 行変えても、毎回すべての
  レイヤーが再ビルドされる、というモデル）。1 回のフルビルドはイメージあたり数分〜
  10 分程度。反復開発中はこれが体感される。
- **入力に変更のないデプロイでは再ビルドされない**: `ContainerImageBuild` は入力 Asset の
  ハッシュを Custom Resource プロパティに埋め込むため、ソース・Dockerfile・`buildArgs`
  のいずれも変化しない `cdk deploy` では Custom Resource は No-Op となり CodeBuild は
  起動しない。「触っていないスタックの CodeBuild が毎回走ってコストがかさむ」ということ
  はない。
- **CodeBuild の同時実行 quota**: ARM/Small の同時実行 quota はデフォルトで 1
  （AWS アカウント全体）。同一スタック内の 2 イメージは `SingletonProject` により
  1 プロジェクトを共有するので直列実行になる。他スタックや他プロジェクトが同時に
  ARM/Small CodeBuild を使う場合はキューイングされる。頻繁に問題になる場合は
  Service Quotas で引き上げ可能（AWS Support 経由）。
- **必要な IAM 権限**: `ContainerImageBuild` は複数の権限主体をまとめて設定する:
  (a) CDK/CloudFormation 実行ロール（`cdk-*-cfn-exec-role-*` 相当）が CodeBuild
  プロジェクト・ECR リポジトリ・Custom Resource Lambda とその実行ロールを **作成**
  できること、
  (b) construct が自動生成する Custom Resource Handler Lambda に `codebuild:StartBuild`
  権限が付与されること（`ContainerImageBuild` が設定する）、
  (c) construct が自動生成する CodeBuild プロジェクトのサービスロールに ECR の
  pull/push 権限が付与されること（`repository.grantPullPush(project)` により
  construct が設定する）。
  標準の `cdk bootstrap` で作成されるロールは (a) の権限を保持する。ただし権限を絞った
  カスタム bootstrap を使う派生アプリでは、これらのリソース作成権限を明示的に追加する
  必要がある。(b)(c) は construct が自動配線するため、キット利用者が意識する対象は (a)
  だけである。
- **CodeBuild 実行コスト**: `general1.small` の従量課金が加算される（1 ビルドあたり
  数円〜十数円のオーダー）。開発中の反復デプロイでは無視できない額に達しうるが、
  上記のとおり入力変更のないデプロイでは CodeBuild が起動しないため、通常運用では
  影響は小さい。
- **`dsql-migrator` の例外**: migrator は deploy-time image build ではなく zip パッケージの `NodejsFunction` とする。CloudFormation はこれをデプロイ中に同期呼び出しする一方、container-image version には初期化 window があり、container-only の `CodeArtifactUserPendingException` が発生しうるためである。`webapp` と `async-job` は引き続き deploy-time build の image とする。