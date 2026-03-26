# Aurora PostgreSQL Express 対応計画

> **ステータス**: Draft
> **作成日**: 2026-03-26
> **背景**: Aurora PostgreSQL に VPC 不要の「エクスプレス設定」が GA (2026-03-25)。DSQL の主要なペイン（FK 不可、JSON 不可、SERIAL 不可、1 DDL/tx、ALTER 制約）がすべて解消されるため、starter-kit で両エンジンを選択可能にする。

## 方針

- 1 リポジトリ・2 ブランチ（`main` = Aurora PG Express、`dsql` = DSQL）
- if 分岐による両対応は行わない。starter-kit の「コピーして自分のものにする」思想と矛盾するため
- `main` を Aurora PG Express 版（新デフォルト）とする。理由は以下の比較に基づく

## DSQL vs Aurora Express — 不都合の比較

両エンジンとも不都合はあるが、**レイヤーが異なる**。

### 不都合の性質

| | DSQL | Aurora Express |
|---|---|---|
| 主なレイヤー | スキーマ設計・ツーリング（開発時） | ランタイム・運用（本番時） |
| 制約の性質 | 静的・予測可能（「これは使えない」） | 動的・状況依存（「この条件で遅くなる」） |
| ペインの感じ方 | 毎日の開発で少しずつ | 本番運用で突然踏む |

### DSQL の不都合

| 制約 | 発見タイミング | 回避コスト | 回避後の副作用 |
|------|--------------|-----------|--------------|
| FK 不可 | generate 時 / lint | 低（`relations()` で代替） | DB レベルの整合性保証を喪失 |
| JSON/JSONB 不可 | generate 時 / lint | 低（TEXT + アプリ層シリアライズ） | 型安全性低下、DB 側クエリ不可 |
| SERIAL 不可 | generate 時 / lint | 低（UUID） | 実質問題なし |
| 1 DDL/tx | migrate 実行時 | 高（カスタムランナー必要） | ツーリング独自化、学習コスト |
| ALTER TABLE 制約 | migrate 実行時 | **高（テーブル再作成）** | スキーマ変更のたびに手動作業リスク |
| 3,000 行/tx | **本番データ量で初めて発覚** | 中（バッチ分割） | コード複雑化 |

### Aurora Express の不都合

| 制約 | 発見タイミング | 回避コスト | 回避後の副作用 |
|------|--------------|-----------|--------------|
| auto-pause 復帰遅延 | **本番アイドル後に初めて発覚** | 中（リトライロジック） | コード複雑化、初回 UX 劣化 |
| 定期ジョブとの相互作用 | **コスト監視で発覚** | 低〜高（頻度設計 or MinCapacity:0.5 で ~$43/月） | コスト増 or ジョブ設計制約 |
| CloudFormation 未対応 | deploy 時 | AwsCustomResource で回避可能だが移行コストあり | IaC 複雑化 |
| カスタム KMS 不可 | 設計時 | 回避不可 | コンプライアンス要件によってはブロッカー |

### 比較軸ごとの評価

**発見のしやすさ**: DSQL が優位。ほとんどの制約が lint / generate / migrate で静的に検出される（例外: 3,000 行/tx）。Aurora Express は auto-pause 復帰遅延・定期ジョブとの相互作用ともに「本番で初めて踏む」タイプ。

**認知負荷**: Aurora Express が優位。標準 PostgreSQL として開発でき、開発中の認知負荷はほぼゼロ。DSQL は「PostgreSQL だがこれらは使えない」という否定リストを常に意識する必要があり、新機能追加のたびに互換性確認が発生する。

**回復のしやすさ**: 同等。DSQL は回避策が確立されている（UUID、relations() 等）が、ALTER TABLE 制約だけはテーブル再作成が必要でデータ量に比例してリスク増大。Aurora Express はリトライロジックを一度書けば安定するが、CFn 未対応は AWS 側の対応待ち。

**アーキテクチャ影響**: DSQL の方が深い。FK 不在によりアプリケーション層での整合性担保が必要で、設計思想に影響する。Aurora Express は定期ジョブの頻度設計程度で、スキーマ設計は自由。

### main を Aurora Express にする根拠

starter-kit は「コピーして育てる」もの。育てる過程で DSQL の制約に毎回ぶつかるのは体験として厳しい。Aurora Express の運用課題はドキュメントで事前に警告すれば対処可能。この非対称性が判断の根拠。

ただし DSQL には「コールドスタートがない」という決定的な運用メリットがある。auto-pause の復帰遅延を許容できないユースケース（リアルタイム性が重要な API 等）では DSQL の方が適切。README で両エンジンの特性を明記し、ユーザーが判断できるようにする。

## リリース戦略

CloudFormation が Express Configuration に未対応（GA 翌日の 2026-03-26 時点で確認済み）のため、AwsCustomResource による暫定実装を避け、CFn 対応を待つ。

### タイムライン

```
Now:     dev/v3 (DSQL) に engine/ リファクタリングを実施（Phase 1）
         ↓
Soon:    dsql ブランチとして公開（v3.0.0-dsql タグ）
         DSQL ユーザーはここから使える
         ↓
Wait:    CFn Express Config 対応を待つ
         この間の改善は dsql ブランチに入れる
         ↓
CFn GA:  dsql をベースに main を作成、engine/ を Aurora Express に差し替え（Phase 2-3）
         v3.0.0 を main でリリース
         ↓
After:   main (Aurora Express) + dsql の2ブランチ運用開始（Phase 4）
```

### この戦略の利点

- **AwsCustomResource が不要** — CFn ネイティブで素直に書ける
- **AwsCustomResource → CfnDBCluster の移行手順が不要** — 3回デプロイの複雑な移行を回避
- **v3 の品質が高い** — 暫定実装なしでリリースできる
- **DSQL ユーザーは待たなくてよい** — dsql ブランチで即座に使える

### CFn 対応待ちのリスク

| 待ち期間 | 影響 | 対応 |
|---------|------|------|
| 数週間 | 理想的。dsql 公開後すぐに main リリース | — |
| 数ヶ月 | dsql ブランチに改善が蓄積。fork 時の差分は engine/ だけなので問題なし | dsql ブランチを事実上の main として運用 |
| 半年以上 | Aurora Express 対応の優先度を再評価 | AwsCustomResource での実装を再検討 |

待ち期間中も dsql ブランチは完全に機能する。ユーザーへの影響はゼロ。

## フェーズ

### Phase 1: engine/ ディレクトリへのリファクタリング（DSQL コードベースのまま）

DB 固有コードを `engine/` ディレクトリに集約し、共通コードとの境界を明示する。機能変更なし。

#### 現状の問題

DB 固有コードが共通ファイルに混入している：

- `main-stack.ts` — 大部分は共通だが `Database` と `DsqlMigrator` の具象型 import がある
- `webapp.ts`, `async-job.ts` — `Database` 具象型を import しているが、実際は `getLambdaEnvironment()` と `grantConnect()` しか使っていない

#### 目標構造

```
packages/db/
  src/
    schema.ts                  ← 共通
  engine/                      ← ★ DB 固有はすべてここ
    client.ts
    cli.ts
    dsql-compat.ts             ← DSQL 版のみ
    check-dsql-compat.ts       ← DSQL 版のみ
    migrate.ts                 ← DSQL 版のみ
  package.json                 ← 依存が異なる

apps/cdk/lib/
  engine/                      ← ★ DB 固有はすべてここ
    index.ts                   ← IDatabase + 具象クラスの re-export
    database.ts
    migrator/
      index.ts
      handler.ts
      Dockerfile
  constructs/                  ← 共通（DB 固有コードなし）
    webapp.ts                  ← IDatabase 経由で依存
    async-job.ts               ← IDatabase 経由で依存
    auth/
    event-bus/
    cf-lambda-furl-service/
  main-stack.ts                ← 共通（engine/ 経由で import）
  us-east-1-stack.ts           ← 共通
```

#### IDatabase インターフェース

```typescript
// apps/cdk/lib/engine/index.ts
import { IGrantable } from 'aws-cdk-lib/aws-iam';

export interface IDatabase {
  grantConnect(grantee: IGrantable): void;
  getLambdaEnvironment(): Record<string, string>;
}
```

`webapp.ts` と `async-job.ts` は `IDatabase` のみに依存。`main-stack.ts` は `engine/` から具象型を import するが、`engine/index.ts` が安定した名前で re-export するため両ブランチで同一コードになる。

#### .branch-specific マニフェスト

```gitignore
# .branch-specific — ブランチ間で異なることが期待されるパス
**/engine/**
packages/db/package.json
oxlintrc.json
.env.local.example
scripts/
apps/cdk/test/__snapshots__/
```

CI はこのファイルを読み、列挙パス以外の差分を検出してエラーにする。

#### 完了後

dsql ブランチとして公開。`v3.0.0-dsql` タグを付与し GitHub Releases に掲載。

### Phase 2: Aurora PG Express 版の実装（CFn 対応後、main ブランチ）

dsql ブランチをベースに main を作成し、engine/ を Aurora Express に差し替え。

#### 実機検証（Phase 2 の最初に実施）

1. CLI で Express Config クラスター作成 → API レスポンス確認
2. IAM 認証接続検証（`@aws-sdk/rds-signer` が Internet Access Gateway 経由で動作するか）
3. auto-pause 復帰時間の実測

#### engine/ 差し替え

- `engine/database.ts` — `CfnDBCluster` with Express Configuration（CFn ネイティブ）
- `engine/client.ts` — RDS Signer ベース + 接続リトライ（auto-pause 復帰対応、v2 のコード参考）
- `engine/migrator/` — drizzle-orm 組み込み `migrate()` 使用
- `engine/cli.ts` — 薄いラッパー

#### その他の変更

- `oxlintrc.json` から DSQL ルール削除
- `scripts/db.sh` 作成
- ドキュメント更新（AGENTS.md, README.md, packages/db/README.md）
- デプロイ検証

#### 完了後

`v3.0.0` を main でリリース。

### Phase 3: CI/CD 整備

#### ブランチ同期ワークフロー

```yaml
# .github/workflows/sync-to-dsql.yml — main → dsql の自動 merge
on:
  push:
    branches: [main]
jobs:
  sync:
    # merge 成功: 自動 push
    # コンフリクト: PR を自動作成
    # pnpm-lock.yaml コンフリクト時: pnpm install で再生成を試行
```

#### 共通ファイル乖離検出

```yaml
# .github/workflows/drift-check.yml
on:
  push:
    branches: [main, dsql]
jobs:
  check:
    # .branch-specific に列挙されたパス以外の差分を検出 → エラー
```

#### 両ブランチビルド

```yaml
# .github/workflows/build.yml
on:
  push:
    branches: [main, dsql]
  pull_request:
    branches: [main, dsql]
```

#### リリース

```yaml
# .github/workflows/release-please.yml
on:
  push:
    branches: [main]
jobs:
  release-please:
    # main で v3.x.x タグ
  tag-dsql:
    # リリース時に dsql ブランチに v3.x.x-dsql タグを自動付与
```

## 削除されるコード量（Aurora PG Express 版、dsql 版との差分）

| ファイル | 行数（概算） |
|---------|------------|
| `packages/db/engine/dsql-compat.ts` | 100+ |
| `packages/db/engine/check-dsql-compat.ts` | 30 |
| `packages/db/engine/migrate.ts` | 80 |
| 関連テスト + fixtures | 500+ |
| **合計** | **~700+ 行 + fixtures** |

## 2ブランチ運用のコンフリクト分析

engine/ リファクタリング済みの状態で fork するため、fork 時点では engine/ 以外は完全に同一。

### コンフリクトが起きないもの

| ファイル群 | 理由 |
|-----------|------|
| `apps/webapp/` 全体 | 共通。main → dsql の merge で clean |
| `apps/async-job/` 全体 | 同上 |
| `packages/shared-types/` | 同上 |
| `apps/cdk/lib/constructs/` (engine/ 以外) | 同上 |
| `apps/cdk/lib/main-stack.ts` | engine/ 経由の import で同一 |
| `**/engine/**` | 各ブランチ固有。merge 対象外 |

### コンフリクトが起きるもの

| ファイル | 頻度 | 解決方法 |
|---------|------|---------|
| **pnpm-lock.yaml** | 依存更新のたび | `pnpm install` で再生成（自動化可能だが要検証） |
| `packages/db/package.json` | 依存追加・更新時 | 差分は deps の 1-2 行。手動解決容易 |
| `oxlintrc.json` | lint ルール変更時 | DSQL ルールの有無だけ。手動解決容易 |
| `apps/cdk/test/__snapshots__/` | CDK 変更時 | 再生成で解決 |
| `*.md` | ドキュメント更新時 | 内容が異なる部分の merge |

**pnpm-lock.yaml が最大の摩擦源。** ただし解決方法は機械的（`pnpm install` 再実行）で、依存更新の頻度は月 1-2 回程度。

## 未解決事項（実機検証が必要、Phase 2 で実施）

1. **auto-pause からの復帰時間** — MinCapacity: 0 での復帰が webapp Lambda タイムアウト（3 分）内に収まるか。収まらない場合は MinCapacity: 0.5 or リトライロジック
2. **IAM 認証の接続パターン** — `@aws-sdk/rds-signer` が Internet Access Gateway 経由で動作するか
3. **CFn Express Config のプロパティ名** — CFn 対応時のプロパティ名・構造は対応後に確認

## 既存クラスターの VPCレス移行（調査日: 2026-03-26）

既存の Aurora クラスター（VPC あり）を Express Configuration（VPC なし）にインプレース変更することは**不可**。`ModifyDBCluster` では VPC の変更はできない。

移行パス: スナップショット → `restore-db-cluster-from-snapshot` に `VPCNetworkingEnabled=false` + `InternetAccessGatewayEnabled=true` を指定してリストア。

v2（Aurora Serverless v1/v2 + VPC）からの移行ユーザーへの影響:
- v3 で DSQL に変更した時点で既にデータ移行が必要だったため、Aurora PG Express への移行コストも同等
- v2 → v3 マイグレーションガイドにスナップショットリストア手順を記載する

参照: https://repost.aws/knowledge-center/rds-vpc-aurora-cluster

## リスク

### 高リスク

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| **pnpm-lock.yaml のコンフリクト** | `packages/db/package.json` の依存差異により lock ファイルが必然的に異なる。main の依存更新が dsql に merge されるたびにコンフリクト | 自動同期ワークフローでコンフリクト時に `pnpm install` 再実行で lock 再生成 |
| **DSQL ブランチの陳腐化** | main が活発に開発される一方、dsql は同期のみ。DSQL 固有の問題への対応が遅れる | dsql ブランチの CI に integ test を含め、壊れたら即検知 |

### 中リスク

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| **CFn 対応の遅延** | 数ヶ月以上かかると main リリースが遅れる | 半年経過で AwsCustomResource 実装を再検討 |
| **コントリビューターの混乱** | PR をどちらのブランチに出すべきか判断が必要 | CONTRIBUTING.md に明記 |
| **auto-pause 復帰のユーザー体験** | 初回アクセス時に遅延。v2 の Aurora Serverless v1 cold start 問題の再来 | DB 接続リトライロジック実装（v2 のコード参考）。README に注意書き |
| **定期ジョブとの相互作用** | 高頻度ジョブで auto-pause が無効化、コスト増 | README で注意喚起。サンプルは月次ジョブのまま維持 |

## 解決済み事項

### CDK/CloudFormation の Express Configuration サポート（調査日: 2026-03-26）

`AWS::RDS::DBCluster` に `ExpressConfiguration` プロパティは存在しない（`aws cloudformation describe-type` で確認、GA 翌日時点）。Internet Access Gateway を有効化するプロパティもない。`addPropertyOverride` では対応不可。

→ CFn 対応を待ってからリリースする戦略を採用。AwsCustomResource は使わない。

参照: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html

### Aurora PG Express のエンドポイント形式（調査日: 2026-03-26）

標準 Aurora PostgreSQL 形式。Internet Access Gateway 経由でも同じエンドポイントを使用：

```
Writer: <cluster-id>.<random>.<region>.rds.amazonaws.com:5432
```

`client.ts` の環境変数 `DB_HOST` に格納するだけで対応可能。

参照: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html

### コスト比較（調査日: 2026-03-26）

Aurora Serverless v2 は `MinCapacity: 0` + `SecondsUntilAutoPause` をサポート（`aws cloudformation describe-type` で確認）。アイドル時は 0 ACU（コンピュート $0）まで自動スケールダウン。

| | DSQL | Aurora PG Express |
|---|---|---|
| アイドル時コンピュート | $0 | $0（auto-pause） |
| アクティブ時 | RPU 課金 | $0.12/ACU-hour |
| ストレージ | $0.25/GB-month | $0.10/GB-month |
| サンプルワークロード (100 users) | ~$0.65/month | ~$1-3/month（推定） |
| コールドスタート | なし | auto-pause からの復帰あり（数秒） |

### drizzle-kit migrate の IAM 認証対応（調査日: 2026-03-26）

`drizzle-kit migrate` CLI は静的 `dbCredentials` が必要で IAM トークン動的生成に非対応。`drizzle-orm/node-postgres/migrator` のプログラマティック `migrate()` は自前 Pool を渡せるため IAM 認証で動作する。薄い CLI ラッパー（`engine/cli.ts`）を維持。

### 既存クラスターの VPCレス変更（調査日: 2026-03-26）

インプレース変更は不可。スナップショット → リストアが必要。v2 → v3 で DB エンジン変更が既に必要だったため、追加の移行コストは同等。

## 作業順序

```
Phase 1 (リファクタリング) ← 今すぐ着手
  ├─ engine/ ディレクトリ作成・ファイル移動
  ├─ IDatabase インターフェース抽出
  ├─ webapp.ts, async-job.ts を IDatabase 依存に変更
  ├─ main-stack.ts を engine/ 経由 import に変更
  ├─ .branch-specific マニフェスト作成
  ├─ テスト・スナップショット更新
  ├─ dsql ブランチとして公開（v3.0.0-dsql タグ）
  └─ ★ 機能変更なし。安全にリリース可能

  ~~~ CFn Express Config 対応を待つ ~~~

Phase 2 (Aurora PG Express 実装) ← CFn 対応後に着手
  ├─ 実機検証（auto-pause 復帰時間、IAM 認証、CFn プロパティ確認）
  ├─ dsql を main に merge（共通の履歴を確立）
  │   git checkout main && git merge dsql
  ├─ main で engine/ を Aurora Express に差し替え
  │   （差分は engine/ + 設定ファイルのみ。以降の main→dsql merge が clean になる）
  ├─ DB 接続リトライロジック実装
  ├─ oxlintrc.json / scripts / ドキュメント更新
  ├─ デプロイ検証
  └─ v3.0.0 を main でリリース

Phase 3 (CI/CD) ← Phase 2 と同時 or 直後
  ├─ sync-to-dsql ワークフロー（pnpm-lock.yaml 自動解決含む）
  ├─ drift-check ワークフロー
  ├─ 両ブランチビルド
  └─ リリースワークフロー（release-please + dsql タグ）
```
