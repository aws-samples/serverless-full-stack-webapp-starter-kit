> この文書は [v3.0.0 GitHub Release](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/releases/tag/v3.0.0)（英語、正本）の日本語版です。内容が食い違う場合は英語版を正とします。

## [3.0.0](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/compare/v2.1.0...v3.0.0) (2026-07-23)

### v3.0.0 — Aurora DSQL、pnpm workspaces モノレポ、oxlint/oxfmt、デプロイ時イメージビルド、CloudFront flat-rate

> **このキットをコピーし、自分のアプリとして育ててください。** このリリースノートは、(a) v3 から新たに始める開発者、(b) 以前に v2 からアプリをコピーし、完全な v3 移行をせずに**どの変更を選択的に採用するか**判断したいオーナー、という2つの読者に向けて書かれています。
>
> **読み方:**
>
> - **v3 から新規に始めますか？** §1 のハイライトを読み、[README の Getting started](../../../README.md#getting-started) に従ってから、§2.3 で説明するデプロイ後の CloudFront Free プラン加入を完了してください。§2.1、§2.2、§3 は主に v2 オーナー向けです。
> - **採用する内容を判断する v2 オーナーですか？** 完全な移行によって受け入れる非互換な変更は §2 を、v2 ツリーに選択的に移植できる改善は §3 を読んでください。
> - 以下のセクション別の適用対象タグ（**「適用対象」**）は、その変更がご自身に関係するかを示します。

#### 1. ハイライト

_(ここに示す数値はすべてサンプルアプリのワークロードにおけるコンポーネント別料金です。v3 のデフォルトを用いた月額合計見積もり（$2.42）は [README の Cost 表](../../../README.md#cost) を参照してください。)_

- **Aurora DSQL + Drizzle ORM** が Aurora Serverless v2 + Prisma を置き換えます。VPC / NAT / bastion は不要で、パブリックインターネット経由の IAM 認証と、最低料金なしの **RPU**（Request Processing Unit — DSQL のトランザクションごとの料金指標。[DSQL 料金ページ](https://aws.amazon.com/rds/aurora/dsql/pricing/)を参照）による従量課金を使用するため、アイドル時のトラフィックのコストはゼロです。[ADR-001](adr-001-dsql-drizzle-migrator.ja.md)を参照してください。トレードオフとして、DSQL はより厳格な DDL セマンティクスを持つ分散 SQL エンジンです（`SERIAL` / FK / `TRUNCATE` なし、トランザクションごとに DDL は1つ、制限された `ALTER TABLE`）。そのため、利用できる ORM パターンが制約されます。
- **pnpm workspaces モノレポ**（`apps/webapp`、`apps/async-job`、`apps/cdk`、`packages/db`、`packages/event-utils`、`packages/shared-types`、および後から追加された `apps/db-migrator`）が、2パッケージの `webapp/` + `cdk/` レイアウトを置き換えます。ワークスペースローカルのパッケージ（例: `@repo/db`、`@repo/shared-types`）により、公開せずにリポジトリ内で型を共有できます。[ADR-002](adr-002-pnpm-workspaces.ja.md)を参照してください。
- **oxlint + oxfmt** が ESLint + Prettier を置き換えます。Rust ベースで、ファイル保存のたびに実行できるほど高速です。`oxlint-tsgolint` による型認識 lint により、個別の `tsc --noEmit` パスは不要になります。[ADR-003](adr-003-oxlint-oxfmt.ja.md)を参照してください。
- `webapp` と `async-job` の Lambda イメージに対する、**`@cdklabs/deploy-time-build` を使用したデプロイ時コンテナイメージビルド**です。デプロイ時にローカル Docker は不要で、CDK synth から CodeBuild（ARM64）でイメージがビルドされます。`db-migrator` は、マイグレーションのコンテンツ変更時に確実に再実行され、コンテナのコールド初期化競合によってデプロイ時マイグレーショントリガーが壊れないよう、意図的に zip パッケージの `NodejsFunction`（esbuild でバンドルされ、Docker も CodeBuild も関与しない）としています（#229 / #231）。[ADR-006](adr-006-deploy-time-image-build.ja.md)を参照してください。
- **CloudFront flat-rate 料金プランのサポート。** AWS マネージド cache policy（`CACHING_DISABLED` + `CACHING_OPTIMIZED`）と、`us-east-1` の `KnownBadInputs` WAF Web ACL を使用します。同じパスの React Server Component（RSC、`text/x-component`）ペイロードが HTML キャッシュを汚染し得る種類のバグを、構造的に排除します（置き換えられた #176）。デプロイ後に **Free プラン**へ加入すると、CDN + WAF + DDoS 対策 + logs が月間 100 万リクエスト / 100 GB まで $0 にまとめられます。**加入するまで、必須の WAF Web ACL は標準 AWS WAF 料金で課金されます**（約 $5/月 + ルールあたり $1/月）。[ADR-007](adr-007-cloudfront-flat-rate.ja.md)および以下の §2.3 を参照してください。

#### 2. 破壊的変更

以下の各項目では、該当するかを判断できるよう、非互換な変更に**「適用対象」**タグを付けています。

##### 2.1 リポジトリレイアウト、データベース、ツールチェーンの全面刷新 — [`c986401`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/c986401)

**適用対象:** **完全な**基盤移行を行う v2 オーナー。v2 にとどまる場合、このセクション全体は適用されません。

v3 キットは、Aurora DSQL + Drizzle ORM + oxlint/oxfmt を使用する pnpm workspaces モノレポ（`apps/*`、`packages/*`）です。Aurora Serverless v2、Prisma、ESLint、Prettier、`webapp/` + `cdk/` の2パッケージレイアウト、`compose.yaml`、`package-lock.json` は削除されました。webapp と async-job は引き続き CloudFront の背後の Lambda で実行されます（webapp はレスポンスストリーミング対応の Lambda Web Adapter を使用）。Cognito、AppSync Events、EventBridge は従来どおりです。

v2 派生アプリへの影響: これは基盤全体の移行です。基盤自体について部分的に採用する方法はありません。その上に構築された個別の改善は §3 に記載しています。

移行ガイド: [`.starter-kit/docs/v3.0.0/migration-prompt.md`](migration-prompt.ja.md) — v2 のコードベースを移行する AI コーディングエージェントが読むことを意図した、段階的なメタプロンプトです。コピーと変換のファイル一覧、`schema.prisma` に基づくスキーマ変換、段階的なビルド検証、DSQL 切り替え後の VPC 接続済み Lambda ネットワーク（Hyperplane ENI）のクリーンアップを扱います。

##### 2.2 マイグレーションファイルを `.sql` + `.mjs` に標準化し、サイレントな再実行に対してランナーを強化 — [`56f7be4`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/56f7be4)

**適用対象:** DSQL 基盤を採用するすべての方（すなわち、§2.1 採用後のみ）。Aurora Serverless v2 + Prisma にとどまる場合、このセクションは適用されません。

`packages/db/migrations/` 配下では `.sql` と `.mjs` ファイルだけが実行されます。`.ts` マイグレーションファイルは黙って無視されます（拒否されるのではなく、ランナーがフィルタリングします）。拡張子を含む完全なファイル名が `_migrations` テーブルに記録されるため、すでに移行済みのデータベースで `0002_foo.ts` → `0002_foo.mjs` とリネームすると、ランナーはそれを新しいファイルとして扱い、**マイグレーションを再実行します**。`dsql-compat` バリデータも、DSQL ではテーブル再作成が必要であるため、インライン制約（DEFAULT / NOT NULL / CHECK / UNIQUE / PRIMARY KEY）を伴う `ADD COLUMN` を拒否するようになりました。

migrator は、`migrations/` ディレクトリを含むバンドルの zip パッケージ `NodejsFunction` です。そのため、**`migrations/` 配下のコンテンツ変更はすべて CDK の標準 asset hash に入り、新しい Lambda バージョンを発行し、次のデプロイでランナーを再実行します**（#231 — これは以前のカスタムディレクトリ hash 機構を置き換え、デプロイ時トリガーを壊すコンテナのコールド初期化競合を構造的に回避します）。

`.ts` マイグレーションがある場合は、(a) 各 `.ts` を `.mjs` にリネームし、コードを移植し（`packages/db/migrations/` 配下の JSDoc 型付きサンプルマイグレーションを参照）、DB 内の `_migrations.name` を一致する名前に更新する、または (b) 各マイグレーションを冪等にして DB を更新せずにリネームします。

移行ガイド: [`.starter-kit/docs/v3.0.0/adr-005-migration-file-format.md`](adr-005-migration-file-format.ja.md)。

##### 2.3 CloudFront: AWS マネージド cache policy + `us-east-1` WAF Web ACL（flat-rate プラン互換） — [`9bfa073`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/9bfa073)

**適用対象:** 新規 v3 ユーザー（デプロイ後の Free プラン加入が必須）**および**選択的採用を検討する v2 オーナー。v2 の場合の移植手順は §3.1 を参照してください。Free プランに意図的に加入せず、Web ACL を削除する場合にのみ省略できます。

カスタム `SharedCachePolicy`（すべてのクエリ文字列、RSC 対応ヘッダー allow-list、すべての Cookie、TTL 0）は、default behavior の AWS マネージド `CACHING_DISABLED` と `/_next/static/*` の `CACHING_OPTIMIZED` に置き換えられます。`KnownBadInputs` マネージドルールだけを含む WAF Web ACL（scope `CLOUDFRONT`、リージョン `us-east-1`）が追加されます（rate-based、`AmazonIpReputationList`、`CommonRuleSet` は意図的に除外しています。理由はインラインコメントと ADR-007 を参照）。`webAclId` は CDK の `crossRegionReferences: true` を通じてメインリージョンスタックに渡されます。

default behavior が一切キャッシュしなくなるため、RSC ペイロード（`text/x-component`）が同じパスの HTML キャッシュを汚染し得る種類のバグを構造的に排除します。また、WAF Web ACL を必要としカスタム cache policy を禁じる CloudFront **flat-rate 料金プラン**（Free / Pro / Business / Premium）への加入を可能にします。

デプロイ後の手動手順: CloudFront コンソールでディストリビューションを開き、**Manage subscription → Free plan** を選択してください。それまで WAF Web ACL は[標準 AWS WAF 料金](https://aws.amazon.com/waf/pricing/)（約 $5/月 + ルールあたり $1/月）で課金されます。WAF を完全にオプトアウトするには、`apps/cdk/lib/us-east-1-stack.ts` の Web ACL を削除し、`apps/cdk/bin/cdk.ts` から `webAclId` を取り除きます（手順は README にあります）。

移行ガイド: [README §4「CloudFront Free プランに加入する」](../../../README.md#4-enroll-in-the-cloudfront-free-plan)および[`.starter-kit/docs/v3.0.0/adr-007-cloudfront-flat-rate.md`](adr-007-cloudfront-flat-rate.ja.md)。

#### 3. 選択的採用ガイド

すでに v2 をコピーしており、基盤全体を移行したくない場合、以下の変更は個別に採用できます。**cherry-pick は文字どおりの意味ではありません**。v2/v3 ではパスが異なる（`webapp/` → `apps/webapp/`、`cdk/` → `apps/cdk/`）ため、`git cherry-pick` は競合します。各エントリは、**「v2 ツリー内の対応するファイルへ diff を手作業で移植する」**ものとして扱ってください。

各エントリは、**v3 のソースファイル** → **v2 の移植先** / **前提条件** / **注記**という形式です。このセクションの件名は標準化した英語のリリースノート用ラベルです。リンク先のコミットにはそのままのコミット件名が示されます（一部は #174/#182/#184/#185/#186 のように日本語です）。

ここに記載しないその他すべての v3 の内容（ワークスペースレイアウト、DSQL マイグレーションランナー、drizzle-kit の generate/check パイプライン、DSQL 互換性バリデータ、simple-git-hooks による pre-commit フック、`ContainerImageBuild` コンテナイメージ、TypeScript の DSQL クラスター CLI、Node 24 ベースイメージ、pnpm 10.34.4、`@repo/event-utils`）は、**v3 基盤から切り離せず**、§2.1 の完全な移行が必要です。

##### 3.1 選択的に採用できる改善

- **[`e62704a`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/e62704a) — `refactor(webapp)`: 認証セッションを分割し、楽観的な proxy チェックを採用。** 破壊的ではない API 変更です。`getSession()` を、キャッシュされる `getAuthSession`、例外を送出しない `tryGetAuthSession`、`getSessionWithUser` に分割します。`proxy.ts` は楽観的な Cookie 存在チェック（Amplify `LastAuthUser`）となり、トークン検証はデータアクセス層へ遅延させます。Vitest と18個のユニットテストを追加します。
  - **v3 のソース → v2 の移植先**: `apps/webapp/src/lib/auth.ts` → `webapp/src/lib/auth.ts`、`apps/webapp/src/proxy.ts` → `webapp/src/middleware.ts`（v2 ツリーが Next.js 16 より前の場合、`middleware.ts` の名前を維持し、その matcher を調整してください）。`app/(root)/page.tsx`、`auth-callback/page.tsx`、`app/api/cognito-token/route.ts` の呼び出し元を更新してください。
  - **前提条件**: なし。テストが不要であれば `vitest.config.ts` は省略してください。
- **[`458414a`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/458414a) — `feat(webapp)`: `withAuth()` API Route 認証ヘルパーを追加し、`/api/cognito-token` を移行。** 破壊的ではありません。
  - **v3 のソース → v2 の移植先**: `apps/webapp/src/lib/api/with-auth.ts` → `webapp/src/lib/api/with-auth.ts`。既存の `app/api/**/route.ts` 配下の Route Handler に採用してください。
  - **前提条件**: `e62704a`（`tryGetAuthSession` を使用）。JSON 以外のレスポンス（bearer、binary）を返すハンドラーは、引き続き `tryGetAuthSession` を直接使用してください。
- **[`a3ee713`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/a3ee713) — `fix(cdk)`: 再デプロイ時の `DELETE_FAILED` を避けるため Lambda@Edge バージョンを RETAIN。** 3行の変更です。
  - **v3 のソース → v2 の移植先**: `apps/cdk/lib/constructs/cf-lambda-furl-service/edge-function.ts` → `cdk/lib/constructs/cf-lambda-furl-service/edge-function.ts`（`currentVersionOptions.removalPolicy = RemovalPolicy.RETAIN` を設定）。
  - **注記**: 保持された Lambda バージョンはデプロイごとに蓄積します。CloudFront レプリカが削除されたことを確認した**後でのみ**、Lambda コンソール / CLI を介して手動で削除してください。
- **[`b18d6c6`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/b18d6c6) — `feat(cdk)`: `Auth` construct で `removalPolicy` / `deletionProtection` を公開。** 破壊的ではありません。デフォルトの UserPool `RemovalPolicy` を `DESTROY` から `RETAIN_ON_UPDATE_OR_DELETE` に変更します。
  - **v3 のソース → v2 の移植先**: `apps/cdk/lib/constructs/auth/index.ts` → `cdk/lib/constructs/auth/index.ts`。
  - **注記**: CI が実行間で環境を破棄する場合、インスタンス化時に `RemovalPolicy.DESTROY` を明示的に渡してください。
- **[`3ceeaf9`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/3ceeaf9) — `fix(webapp)`: Amplify サーバー認証 Cookie に `httpOnly` / `secure` / `sameSite` を設定。**
  - **v3 のソース → v2 の移植先**: `apps/webapp/src/lib/amplifyServerUtils.ts` → `webapp/src/lib/amplifyServerUtils.ts`（`runtimeOptions.cookies` ブロックを追加）。
  - **注記**: アプリを平文 HTTP で配信する場合（例: カスタムドメインを使うコンテナ化された非 HTTPS テスト環境）、`secure: true` によって Cookie が抑制されます。トポロジーに対して検証してください。
- **[`5b6cf43`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/5b6cf43) — `fix(webapp)`: `/api/health` readiness route を追加し、Lambda Web Adapter を 1.0.1 にアップグレード。**
  - **v3 のソース → v2 の移植先**: `apps/webapp/src/app/api/health/route.ts` → `webapp/src/app/api/health/route.ts`（未認証の `GET`、200 を返し、DB / 認証の probe は行わない）。Dockerfile の `COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1`。DSQL grant partition の修正（`Stack.formatArn()`）は、`aws-cn` / `aws-us-gov` で DSQL を使う場合にのみ適用されます。
  - **前提条件**: Dockerfile が `AWS_LWA_READINESS_CHECK_PATH=/api/health` を設定している、または LWA を使用していること。
- **[`a0d90c8`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/a0d90c8) — `chore`: `pnpm-workspace.yaml` に `minimumReleaseAge: 4320`（72h）を固定。** サプライチェーン強化です。
  - **v3 のソース → v2 の移植先**: v2 ツリーがすでに `pnpm-workspace.yaml` を使用している場合にのみ適用されます。まだ npm を使用している場合は、文字どおりには移植できません。最も近い npm の同等機能は正確なバージョンの固定です。
  - **注記**: 72時間以内にリリースされた hotfix が必要な場合、`pnpm add pkg@x.y.z --ignore-workspace` を一時的な回避策として使用してください。
- **[`7c7926b`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/7c7926b) / [`530c512`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/530c512) / [`568dba0`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/568dba0) — `docs`: v3.0.0 設計ドキュメント、ADR、移行プロンプト（初版 + 書き直し + 段階的な検証手順）。** ドキュメントであり、ランタイムへの影響はありません。
  - **v3 のソース → v2 の移植先**: 設計記録が必要であれば `.starter-kit/docs/v3.0.0/*` をアプリへコピーしてください。メタプロンプトは `v2 → v3` 移行を対象としており、その移行を計画している場合にのみ役立つことに注意してください。

##### 3.2 選択的に採用できるリリースブロッカー修正（PR [#226](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/pull/226)）

統合修正 PR [#226](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/pull/226)（review-triage レポートの A1–A7）。`dev/v3` には単一コミットとして squash されています（D6 ブランチポリシーによる）。個々のコミットとその diff は PR を参照してください。個別パッチの v2 への移植可能性は異なります。

| ID  | v3 commit                                                                                           | 種別               | 概要                                                                                                                                                                                                                | v2 へ移植可能か                                                                                                |
| --- | --------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A1  | [`9f40813`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/9f40813) | `fix(cdk)`         | スケジュールされたサンプル EventBridge ジョブに discriminated union ペイロードを送信するよう修正（以前のサンプルジョブのペイロードは受信時に Zod バリデーションに失敗していました）。                               | 部分的 — v2 は `@repo/shared-types` を使用しません。ペイロード形式と Zod スキーマを手作業で移植してください。  |
| A2  | [`0400216`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/0400216) | `fix(cdk)`         | Cognito 親 A レコードに `8.8.8.8` ではなく RFC 5737 の文書用 IP（`192.0.2.1`）を使用（aws-samples style-guide 準拠）。                                                                                              | はい — 1行の変更です。                                                                                         |
| A3  | [`0ed3e7f`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/0ed3e7f) | `fix(cdk)`         | AppSync の subscribe auth で Cognito の `username` ではなく `sub` を使用し、`startsWith` prefix チェックに末尾の `/` 区切りを強制（prefix 衝突を回避）。                                                            | v2 ツリーが同じ AppSync Events authorizer パターンを使用する場合は可能 — resolver の diff を移植してください。 |
| A4  | [`b2220ea`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/b2220ea) | `chore(ci)`        | `.github/workflows/update_snapshot.yml` を削除（`issue_comment` による snapshot 再生成ワークフローは、write-token のコード実行に関するポリシーホールでした。snapshot 変更は通常の PR フローを通すようになります）。 | v2 ツリーに同等のワークフローがあれば、削除してください。                                                      |
| A5  | [`a19c02c`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/a19c02c) | `fix(event-utils)` | `sendEvent()` が失敗を黙って飲み込むのではなく、非 2xx の AppSync レスポンスで例外を送出するように修正（`res.ok` チェック）。文書化された E2E 配信保証を保護します。                                                | v2 の `sendEvent` 実装に `res.ok` チェックを移植してください（パスは異なります）。                             |
| A6  | [`d9f6c42`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/d9f6c42) | `fix(cdk)`         | `prefix-generator.js` カスタムリソースのログを allow-list 済みフィールドのサブセットのみに限定。CloudWatch への presigned `ResponseURL`（secret）の漏えいを防ぎます。                                               | v2 ツリーが同じカスタムリソースを使用している場合は可能 — `logSafeEvent` ヘルパーを移植してください。          |
| A7  | [`6d192f3`](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/6d192f3) | `docs`             | AGENTS.md: `proxy.ts` の説明を修正（`middleware.ts` の名称を変更した Next.js 16 のファイル規約。別個の Edge worker ではなく Lambda ハンドラー内で実行されます）。                                                   | v2 は `middleware.ts` を使用します — このドキュメント修正は v3 固有です。                                      |

v3 のリリース後、#226 は A1–A7 を単一コミットとして `dev/v3` に squash マージしているため、A1–A7 は個別コミットとして `main` には現れないことに注意してください（D6 による）。完全な diff の参照可能なアンカーは PR #226 です。

#### 4. 非推奨および削除された機能

**適用対象:** 新規 v3 ユーザーおよび完全移行を行う v2 オーナー。すでに v2 をコピーして v2 にとどまる場合、このリリースは既存アプリを変更も破壊もしません。以下の削除は v3 テンプレート / 完全な v3 移行にのみ適用されます。強制移行のスケジュールはありません。

| 削除されたもの                                                    | 置き換え先 / 理由                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Aurora Serverless v2 + Prisma                                     | Aurora DSQL + Drizzle ORM。§2.1 および [ADR-001](adr-001-dsql-drizzle-migrator.ja.md)を参照してください。                                                    |
| VPC / private subnet / NAT / bastion                              | DSQL はパブリックインターネット経由で IAM 認証を使用します — VPC スコープのコンピューティングは不要です。                                                    |
| ESLint + Prettier                                                 | oxlint + oxfmt。§1 のハイライトおよび [ADR-003](adr-003-oxlint-oxfmt.ja.md)を参照してください。                                                              |
| `compose.yaml`（ローカル開発）                                    | Aurora DSQL は実際のクラスターを提供するため、ローカル Postgres エミュレーションは不要です。`pnpm --filter @repo/db run cluster create` を使用してください。 |
| `scripts/dsql.sh`                                                 | `pnpm --filter @repo/db run cluster [create\|delete\|status] [--region REGION]`（TypeScript、`packages/db/src/cluster-cli.ts` 内）。                         |
| npm / `package-lock.json`                                         | pnpm 10.34.4 + `pnpm-lock.yaml`。ルートの `packageManager` と `engines.pnpm` を宣言しています。                                                              |
| カスタム CloudFront `SharedCachePolicy`                           | AWS マネージド `CACHING_DISABLED` + `CACHING_OPTIMIZED`。§2.3 および [ADR-007](adr-007-cloudfront-flat-rate.ja.md)を参照してください。                       |
| `webapp/prisma/`、`webapp/src/lib/prisma.ts`、`webapp/src/jobs/*` | `packages/db/`（スキーマ、マイグレーション、クライアント）および `apps/async-job/`（ハンドラー）へ移動。                                                     |
| ルートスクリプト（`pnpm run dev` など、13エイリアス）             | 削除。ワークスペース単位のコマンド（`cd apps/webapp && pnpm run dev`）または全ワークスペースに対する `pnpm -r run <task>` を使用してください。               |
| `update_snapshot.yml`                                             | 削除（A4）。snapshot 変更は通常の PR フローを通します。                                                                                                      |

#### 5. 既知の制約

各制約には、その制約が影響するかを採用する v3 の範囲に応じて判断できるよう、適用対象を付けています。

- **DSQL の制約** _(適用対象: 完全な v3 基盤 — Aurora DSQL を使用するすべての方)_ — `SERIAL` / `SEQUENCE` は使用不可（UUID を使用）、FOREIGN KEY は使用不可（クエリ時の join には Drizzle `relations()` を使用）、`TRUNCATE` は使用不可（`DELETE FROM` を使用）、`CREATE INDEX` には `ASYNC` が必要、トランザクションごとに DDL は1つ、`ALTER TABLE` は制限されています（制約なしの `ADD COLUMN`、`RENAME`、`SET SCHEMA`、`OWNER TO`、`IDENTITY` のみ）。完全な一覧は `AGENTS.md` と [ADR-001](adr-001-dsql-drizzle-migrator.ja.md) にあります。
- **`RETAIN_ON_UPDATE_OR_DELETE` のデフォルト** _(適用対象: 完全な v3 基盤。DSQL クラスターと Auth construct は §3.1 で個別採用した場合も該当)_ — DSQL クラスターと Cognito UserPool は `cdk destroy` 時に保持されます。不要になった場合は手動で削除してください。自動 tear-down（CI）の場合、両方の construct で `RemovalPolicy.DESTROY` を明示的に渡してください。
- **Lambda@Edge バージョンは蓄積する** _(適用対象: §3.1 の `a3ee713` または完全な v3 基盤を採用するすべての方)_ — CloudFront レプリカの削除は非同期のため、v3 はデプロイ失敗を避けるために古い Lambda@Edge バージョンを保持します。CloudFront ディストリビューションがまだそのバージョンを参照していないことを確認した**後でのみ**、Lambda コンソール / CLI で手動削除してください。
- **CloudFront Free プランへの加入は手動** _(適用対象: 新規 v3 ユーザーおよび §2.3 の CloudFront 変更を採用するすべての方)_ — CDK ではディストリビューションを flat-rate プランへ加入させられません。最初のデプロイ後にコンソールから加入してください。それまで Web ACL は標準 WAF 料金で課金されます。
- **v3 の DSQL admin ロール** _(適用対象: 完全な v3 基盤 — Aurora DSQL を使用するすべての方)_ — webapp と async-job は `DbConnectAdmin` で接続します（[ADR-004](adr-004-dsql-admin-role.ja.md)を参照）。本番の強化（DML 専用アプリケーションロールの作成と権限付与）は今後の作業として文書化されています。
- **デプロイ時イメージビルドにはローカル Docker キャッシュがない** _(適用対象: 完全な v3 基盤)_ — イメージコンテンツを変更するたびに CodeBuild ARM64 ジョブが起動します。トレードオフは [ADR-006](adr-006-deploy-time-image-build.ja.md)に記載しています。
