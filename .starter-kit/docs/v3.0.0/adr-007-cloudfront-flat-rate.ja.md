# ADR-007: CloudFront flat-rate 料金プランへの適合

## ステータス

採択（v3.0.0）

## コンテキスト

Amazon CloudFront は 2025 年に **flat-rate 料金プラン**（Free / Pro / Business / Premium）を
導入した。CloudFront CDN、AWS WAF、DDoS 対策、CloudWatch Logs 取り込み、Route 53 DNS、
S3 ストレージクレジット、サーバーレスエッジコンピュートを月額固定でバンドルし、超過課金は
発生しない（出典: [CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)）。**Free プラン**は月額 $0 で
1M リクエスト + 100 GB データ転送を含む — キットの想定利用規模（`README.md` の
Cost セクション: 100 users/月 × 1000 requests/user）に十分収まる。

このプランに加入するには、CloudFront distribution の構成が以下の 2 つの制約を満たす必要が
ある:

1. **カスタム cache policy が禁止**: AWS マネージド cache policy のみ利用可能。カスタム
   cache policy は Business / Premium プランでのみ許可される（出典: [Pricing plan features](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)
   の "Custom caching rules" 行 — Free/Pro は空欄、Business/Premium のみ Yes）。
2. **WAF Web ACL の関連付けが必須**: distribution に AWS WAF Web ACL（scope=CLOUDFRONT）を
   関連付ける必要がある。pay-as-you-go に戻さない限り、この関連付けは外せない（出典:
   [Using AWS WAF with CloudFront Flat-Rate Pricing Plans](https://docs.aws.amazon.com/waf/latest/developerguide/cloudfront-features.html) の "A valid AWS WAF protection pack
   (web ACL) must remain associated..." の一節）。

v3 初期のキット構成は **カスタム `CachePolicy`**（共有 `SharedCachePolicy`）を default behavior に
使用しており、上記 1 の制約に反してプラン加入を阻んでいた。同じ policy の `allowList` の
副作用として、Next.js App Router の RSC ペイロード（Content-Type `text/x-component`）が
通常の HTML キャッシュを汚染しうる問題も抱えていた（Issue #176）。allowList に RSC 関連
ヘッダを追加する対処（PR #183）が試みられたが、これは RSC 汚染は解消するものの、
制約 1 は残り、プラン加入を可能にはしない。

キットの用途（サーバーレススタックのプロトタイプ / 学習用）とコスト目標（$10/月未満で
始まる — DESIGN_PRINCIPLES）を踏まえると、Free プランへの加入経路をキットのデフォルト
構成として提供する価値が高い。

## 決定

CloudFront distribution を flat-rate プラン（Free / Pro）加入可能な構成にデフォルトで
配線する。加入操作自体は CDK でサポートされていないため、README にコンソール手順を
明記した上で、**構成上加入を阻む要素を除去**する。

### AWS マネージド cache policy のみを使う（`apps/cdk/lib/constructs/cf-lambda-furl-service/service.ts`）

- **default behavior → `CachePolicy.CACHING_DISABLED`**（min/max/default TTL = 0）。
  CloudFront は動的レスポンスを一切キャッシュしない。結果として:
  - RSC ペイロードによる通常 HTML キャッシュの汚染（Issue #176）が原理的に発生しない
    — キャッシュ対象がないため。allowList を調整する PR #183 の対症療法を、構造的な
    解決で置き換える。
  - Cookie / Authorization を cache key に含める必要がない（cache key が存在しない）。
  - リクエスト転送は従来通り `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` により
    ヘッダ・クッキー・クエリ・ボディをすべて origin に転送する。オリジン到達時の
    アプリ挙動は不変。
- **`/_next/static/*` → `CachePolicy.CACHING_OPTIMIZED`**。Next.js が発行する immutable かつ
  content-hash 付きのビルド資産をエッジでキャッシュし、Lambda origin に毎回到達させない。
  資産は公開・パス依存のみ・不変のため、マネージド policy の cache key（Cookie/クエリなし）で
  安全。Free プランは cache behavior 上限 5 のうち 2 を使用する。

### WAF Web ACL をデフォルトで同梱（`apps/cdk/lib/us-east-1-stack.ts`）

`us-east-1` に最小構成の `CfnWebACL`（scope `CLOUDFRONT`、default action `allow`）を作成し
distribution に関連付ける。ルールは **`AWSManagedRulesKnownBadInputsRuleSet` のみ**。他の
managed rule group / rate-based rule は意図的に含めない（後述）。ARN は cross-region で
main-stack に公開し、`CloudFrontLambdaFunctionUrlService` の `webAclId?` プロパティで
関連付ける。

### オプトアウト経路（copy-and-edit）

WAF が不要な派生アプリのために runtime flag は設けず、キットの「コピーして育てる」原則に
従い**削除の型で**オプトアウトを提供する: `us-east-1-stack.ts` の Web ACL 生成を削除し、
`bin/cdk.ts` から `webAclId` を渡さなければよい（`webAclId?` は `service.ts` で optional なので
削除だけで動作する）。この手順は README に明記する。

### WAF ルールを `KnownBadInputs` のみに絞る根拠

管理ルールセットを最小に保つ理由は、starter kit で「不可解な 403 が返る」体験を避けるため:

- **`AWSManagedRulesCommonRuleSet` を除外**: `NoUserAgent_HEADER` はヘルスチェック /
  サーバーサイド fetch で誤検知し、`SizeRestrictions_Cookie` は Amplify / Cognito の
  大きな認証 Cookie で誤検知する（実測ベースの既知パターン）。
- **`AWSManagedRulesAmazonIpReputationList` を除外**: リクエスト内容と無関係に送信元 IP
  レピュテーションでブロックするため、エンドユーザーには原因不明な 403 として現れる。
  デバッグ経路がない。
- **rate-based rule を除外**: 共有 NAT / 企業プロキシ、負荷試験、Next.js のプリフェッチ
  バースト等、正当なトラフィックで発火し、原因が見えないブロックを引き起こす。
- **`KnownBadInputs` は保持**: Log4Shell 等の実在する攻撃シグネチャに一致するため、
  正当なトラフィックが誤検知される余地が少ない。

派生アプリでトラフィックの性質を理解した後、Free プラン上限（5 ルール）の範囲で追加する
のはユーザーの判断に委ねる。

### 却下した代替案

- **カスタム `CachePolicy` を維持したまま `allowList` に RSC ヘッダを追加**（PR #183 の
  方向性）: RSC 汚染は解消するが、制約 1（カスタム cache policy 禁止）が残るため
  Free/Pro プランに加入できない。RSC 汚染の解消も allowList を維持する運用負荷を伴う。
- **`CACHING_DISABLED` の代わりにマネージド `USE_ORIGIN_CACHE_CONTROL_HEADERS`**:
  マネージド cache policy 制約は満たすが、オリジンの `Cache-Control` ヘッダ次第で
  キャッシュされうる。Next.js App Router は RSC/HTML/API を単一の Lambda で返すため、
  ヘッダ制御を誤ると同じ path で異なる Content-Type がキャッシュされうる。structural
  な保証がなくなる。
- **`CommonRuleSet` + `AmazonIpReputationList` + rate-based rule をデフォルト同梱**:
  一般的な「WAF ベストプラクティス」に見えるが、starter kit の学習体験を「不可解な
  403 デバッグ」に変えてしまう。上記の誤検知パターンは実測に基づく。ユーザーが
  段階的に追加する方が良い。
- **CDK でプラン加入を自動化**: 現時点で CloudFront plan enrollment は CDK / CloudFormation
  で操作できない。コンソール手動操作が唯一の経路のため、README で誘導する。

## 結果

- **Free プラン加入の経路が用意された**: 単一コマンド `pnpm exec cdk deploy --all` で
  distribution + Web ACL が揃い、コンソールで **Manage subscription → Free plan** を
  選ぶだけで加入できる（README「Enroll in the CloudFront Free plan」参照）。
- **加入までの WAF 課金**: Web ACL は加入前は [標準 AWS WAF 料金](https://aws.amazon.com/waf/pricing/)
  で課金される（月額 $5 + ルール数 × $1）。デプロイ直後に加入手順を実行しないと想定外の
  課金が生じるため、README の警告と `README.md#4-enroll-in-the-cloudfront-free-plan`
  への誘導を明示。
- **動的リクエストはすべて Lambda origin に到達**: default behavior が `CACHING_DISABLED`
  のため、認証済みリクエスト・HTML・RSC・API はすべて Lambda に到達する。Lambda / Lambda@Edge
  のコスト（Cost セクション参照）は flat-rate プラン外で従量課金される。SSR/Lambda コストが
  課題になる派生アプリは、キャッシュ戦略の見直し（Business/Premium でカスタム cache policy 導入、
  もしくは pay-as-you-go に切り替え）を検討する。
- **静的資産のオフロード**: `/_next/static/*` は edge cache により Lambda に到達しない。
  Free プランの 100 GB データ転送はここに大きく寄与する。
- **`webAclId?` と `geoRestriction?` は `CloudFrontLambdaFunctionUrlService` construct の
  optional prop**: 派生アプリが Web ACL を外したい場合、`bin/cdk.ts` から `webAclId` を
  渡さない（Web ACL リソース自体も削除）だけで pay-as-you-go 構成に戻る。オプトアウトの
  互換性は construct レベルで担保されている。
- **AWS WAF Web ACL は `us-east-1` にのみ作成可能**（scope=CLOUDFRONT の要件）。main stack と
  分けた `us-east-1-stack.ts` に配置し、ARN を cross-region 参照で main-stack に渡す構造は
  既存の Lambda@Edge / ACM 証明書と同じ経路を再利用する。
