# v3.0.0 ドキュメント作成

親タスク: `.kiro/specs/pnpm-workspaces/plan.md` タスク 10（ドキュメント更新）, 11（マイグレーションガイド作成）を拡張。design doc と ADR は親タスクの範囲外だが、同じ v3 リリースの一環として本計画で追加する。

## なぜこの変更が必要か

v3 は DB エンジン（Aurora Serverless v2 → DSQL）、ORM（Prisma → Drizzle）、パッケージマネージャ（npm → pnpm）、Linter（ESLint → oxlint）を同時に変更するメジャーバージョンアップである。DESIGN_PRINCIPLES.md は「ADR を導入すべきタイミング」として「major technology decision (e.g., ORM migration, database engine change)」を明記しており、今回がまさにその時である。

現状、v3 の変更意図と意思決定の根拠はメンテナー向け計画書（plan.md, drizzle-dsql-migrator-plan.md）に散在しており、以下の問題がある:

1. **再現性の欠如**: 将来のメンテナーが「なぜこの構成になったか」を理解し、同じ判断を再現できない。さらに、AI 駆動開発においては intent を保存しておくことに固有の価値がある。モデルやワークフローが進化したとき、既存コードをパッチするより intent から再生成した方が品質が高くなる場合がある。コードは技術的負債を蓄積するが、intent は陳腐化しない
2. **ADR の不在**: DESIGN_PRINCIPLES.md の Technology choices テーブルは結論のみで、検討した代替案と却下理由が記録されていない
3. **マイグレーションガイドの不足**: 既存の `v3-pnpm-workspaces-prompt.md` は Breaking changes の列挙に留まり、AI agent がユーザーのコードベースを安全に移行するための情報（フェーズ分割、データ損失防止、チェックポイント）が欠けている

また、このキットは「copy and grow」を標榜しているが、ユーザーの利用形態はファイルのコピーだけではない。design doc を読んで intent を理解した上で、自分の文脈に合わせて AI agent に再実装させる — つまり「コードのコピー」ではなく「intent の追体験」という使い方が想定される。この利用形態を支えるには、コードだけでなく intent が十分な粒度で記録されている必要がある

## ドキュメント配置方針

`design/` ディレクトリを廃止し、DESIGN_PRINCIPLES.md を `.serverless-full-stack-webapp-starter-kit/` 直下に移動。`docs/` 配下にメジャーバージョンごとのフォルダを作成する。

```
.serverless-full-stack-webapp-starter-kit/
  DESIGN_PRINCIPLES.md          ← design/ から移動
  docs/
    imgs/
    v3.0.0/
      design.md                 ← 新規: 変更意図
      adr.md                    ← 新規: 意思決定の根拠
      migration-prompt.md       ← 新規: AI agent 向けマイグレーションメタプロンプト
```

DESIGN_PRINCIPLES.md の ADR セクションを更新し、この配置規約を記載する。main ブランチの `87abeb9` で追加された Migration guides セクションの内容を参考にするが、リベースは行わない（競合があるため別タスクで実施）。

## タスク

### 1. ディレクトリ構造の変更

- `DESIGN_PRINCIPLES.md` を `.serverless-full-stack-webapp-starter-kit/design/` から `.serverless-full-stack-webapp-starter-kit/` 直下に移動
- `design/` ディレクトリを削除
- `.serverless-full-stack-webapp-starter-kit/docs/v3.0.0/` ディレクトリを作成
- リポジトリ内の DESIGN_PRINCIPLES.md への参照パスを更新（CONTRIBUTING.md, README.md 等）

ゴール:
- `rg 'design/DESIGN_PRINCIPLES' --type md` が exit 1（旧パスへの参照がない）

### 2. design.md の作成

v3 の変更内容と意図を記述する design doc。目的は 2 つ:

1. 将来のメンテナーが「なぜこの構成になったか」を理解し、同じ判断を再現できること
2. ユーザーや AI agent が kit のコードをそのままコピーするのではなく、intent を読んで自分の文脈に合わせて再実装（追体験）できること。モデルやツールが進化したとき、コードからではなく intent から再生成する方が合理的な場合がある

記述すべき内容:
- **Overview**: v3 の変更の全体像（1 段落）
- **Motivation**: v2 の 3 つの問題（コード同居、Prisma バイナリ、VPC 必須）と、それらを同時に解決する戦略
- **Target architecture**: パッケージ構成（apps/, packages/）と依存関係の方向
- **Key design decisions**: 各技術選定の intent（なぜその形にしたか）。DESIGN_PRINCIPLES.md の Technology choices テーブルを補足する深さで記述
  - DSQL: VPC 不要、pay-per-request、IAM 認証
  - Drizzle: pure TS、relations() と DSQL の整合、Prisma 7 の不確実性
  - Migration runner: 3 層分離（コアロジック / Lambda ハンドラー / CDK Construct）の意図
  - DSQL compatibility strategy: 2 層検知（oxlint + SQL バリデーション）の意図
  - pnpm workspaces: strict mode、Docker ビルドの制約
  - oxlint + oxfmt: 速度、DSQL 非互換パターンの早期検出
- **Known constraints and trade-offs**: DSQL の DDL 制約一覧、Drizzle の DSQL 正式サポート未リリース、oxlint の no-restricted-syntax 未サポート

情報源: plan.md の「なぜこの変更が必要か」「方針決定事項」「リスク」セクション、drizzle-dsql-migrator-plan.md の Phase 1

ゴール:
- design.md に Motivation, Target architecture, Key design decisions セクションがあり、各技術選定（DSQL, Drizzle, migration runner, pnpm, oxlint）の intent が記述されている

### 3. adr.md の作成

v3 の主要な技術選定を ADR フォーマット（Nygard: Status → Context → Decision → Consequences）で記録する。代替案と却下理由は Decision セクション内に「Rejected alternatives」として含める。

ADR の粒度: 依存関係のある意思決定は 1 つの ADR にまとめ、読み手が複数 ADR を行き来する認知負荷を避ける。

記述すべき ADR:

**ADR-001: Aurora DSQL + Drizzle ORM + Custom migration runner**
- DSQL を選んだ理由 → それに伴い Drizzle が自然な選択 → drizzle-kit migrate が使えないから自前ランナー、という一本の意思決定チェーンを 1 ドキュメントで記述
- Context: VPC コスト・Prisma バイナリ・モノレポ共有の問題
- Decision + Rejected alternatives:
  - DB: Aurora Serverless v2 維持、DynamoDB、Neon
  - ORM: Prisma + aurora-dsql-prisma-tools、Kysely、手書き SQL
  - Migration: drizzle-kit migrate（不可: 全マイグレーションを 1 トランザクションで実行）、drizzle-kit push（不可: DSQL 制約無視）、Flyway
- Consequences: DDL 制約対応、ランナー保守コスト、Drizzle DSQL 正式サポート未リリースのリスク

**ADR-002: pnpm workspaces monorepo**
- Context: webapp/ に全コードが同居、async-job の Docker ビルドで不要な依存
- Decision + Rejected alternatives: npm workspaces、Turborepo + pnpm
- Consequences: Docker ビルドでの `--filter` 不可、`.dockerignore` + `ignoreMode: IgnoreMode.DOCKER` 必須

**ADR-003: oxlint + oxfmt**
- Context: Linter 速度、DSQL 非互換パターンの早期検出
- Decision + Rejected alternatives: ESLint + Prettier 維持、Biome
- Consequences: `no-restricted-syntax` 未サポート（oxlint v1.56.0 時点）

情報源: plan.md の「方針決定事項」「要調査事項」「リスク」セクション、drizzle-dsql-migrator-plan.md の Phase 1 セクション 2-3

ゴール:
- 各 ADR に Status, Context, Decision（Rejected alternatives 含む）, Consequences セクションがある
- ADR-001 が DSQL → Drizzle → migration runner の意思決定チェーンを一貫して記述している

### 4. migration-prompt.md の作成

AI coding agent がユーザーのコードベースを v2 から v3 に安全に移行するためのメタプロンプト。既存の `docs/migration/v3-pnpm-workspaces-prompt.md` を置き換える。

対象読者: AI coding agent（人間ではない）
前提: ユーザーは v2 kit からコピーした独自アプリと、稼働中の Aurora Serverless v2 を持っている

記述すべき内容:

- **Purpose**: このドキュメントの目的と読み手（AI agent）への指示
- **Prerequisites**: ユーザー環境の前提条件

- **Phase 0: バックアップと事前検証**
  - Aurora Serverless v2 のスナップショット取得
  - `pg_dump --schema-only` でスキーマダンプ
  - `pg_dump --data-only` でデータダンプ
  - ユーザーの現在のスキーマを確認（テーブル一覧、カラム定義、インデックス、データ型）。kit のデフォルトスキーマとの差分ではなく、現在の全体像を把握する
  - チェックポイント: バックアップの存在確認、リストア手順の検証

- **Phase A: パッケージマネージャ移行（npm → pnpm）**
  - チェックポイント: `pnpm install` が exit 0

- **Phase B: モノレポ構造化（apps/ + packages/）**
  - チェックポイント: 各パッケージの `tsc --noEmit` が exit 0

- **Phase C: ORM 移行（Prisma → Drizzle）**
  - Phase 0 で取得した `pg_dump --schema-only` のダンプを参照し、v3 の schema.ts のパターンに従って Drizzle スキーマを手書きする。DSQL 制約を意識しながら書く必要があるため、`drizzle-kit introspect`（Aurora v2 に接続して自動生成）は推奨しない — 出力が DSQL 非互換（serial, references, json 等）で全面修正が必要になる
  - Prisma → Drizzle のクエリ変換パターン（findMany → db.query/db.select、create → db.insert、update → db.update、delete → db.delete）
  - DSQL 非互換型のスキーマ定義変換（コードレベル）: SERIAL → UUID/IDENTITY、ENUM → TEXT、JSON/JSONB → TEXT、FK → relations()
  - numeric 型の注意: Prisma では number、Drizzle では string
  - チェックポイント: `pnpm run build` が exit 0、Prisma への依存がない

- **Phase D: DB 移行（Aurora Serverless v2 → DSQL）**
  - CDK デプロイを分割する理由: 一発デプロイすると Aurora v2 が削除されデータが消失する
  - **D-1: DSQL クラスタ作成**（CDK デプロイ 1 回目）
    - CDK コードで Aurora v2 リソースに `RemovalPolicy.RETAIN` を設定してからデプロイ。CDK のデフォルトではスタック更新時にリソースが置き換わると旧リソースが削除されるため、明示的に RETAIN を設定してデータ消失を防ぐ
    - DSQL クラスタを追加し、webapp/async-job はまだ Aurora v2 に接続したまま
    - チェックポイント: DSQL クラスタが ACTIVE、Aurora v2 がまだ存在
  - **D-2: データ移行**
    - DSQL にマイグレーション実行（スキーマ作成）
    - Aurora v2 → DSQL へのデータ移行（メンテナンスウィンドウ推奨）
    - DSQL 制約への既存データの適合: SERIAL PK → UUID 値の生成と付与、ENUM 値 → TEXT 値への変換、FK 制約の削除
    - データ移行方法の選択肢: 小規模（pg_dump + スクリプト）、大規模（DMS + S3 経由、sample-migration-aurora-dsql-using-ai を参照）
    - 3,000 行超のテーブルは 500-1,000 行単位でバッチ INSERT（DSQL のトランザクション行数上限）
    - チェックポイント: DSQL のレコード数 = Aurora v2 のレコード数（テーブルごとに検証）
  - **D-3: アプリ切り替え**（CDK デプロイ 2 回目）
    - CDK コードから Aurora v2 リソース定義を削除し、webapp/async-job の DB 接続先環境変数を DSQL エンドポイントに変更してデプロイ
    - チェックポイント: アプリが DSQL 経由で正常動作（CRUD + async job）
  - **D-4: 旧リソース削除**（CDK デプロイ 3 回目、またはユーザー判断で手動）
    - Aurora v2 クラスタ、VPC、NAT Instance、Bastion Host の削除
    - ポイントオブノーリターン: agent はユーザーに明示的確認を求めること
    - VPC ENI 残存問題への対処手順

- **Phase E: Linter 移行（ESLint → oxlint）**
  - チェックポイント: `pnpm run lint` が exit 0、ESLint への依存がない

- **Safeguards（agent への指示）**
  - 各フェーズ完了後にチェックポイントを検証し、失敗したら次のフェーズに進まない
  - Phase D-4（旧リソース削除）の前にユーザーの明示的承認を得る
  - データ移行前にバックアップの存在を再確認する
  - ロールバック条件: 各フェーズで「ここで止めてもデータは安全」であることを保証

- **Breaking changes reference**: 既存の v3-pnpm-workspaces-prompt.md の内容（Prisma→Drizzle クエリ変換、DSQL 制約、VPC ENI 問題、Docker ビルド制約）を統合

情報源: plan.md のタスク 12（段階的検証）、既存の `v3-pnpm-workspaces-prompt.md`、drizzle-dsql-migrator-plan.md

参照すべき外部ドキュメント:
- https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html — AI agent による DSQL 移行の公式ガイド。テーブル再作成パターン、Safety features、バッチ移行の指針
- https://github.com/aws-samples/sample-migration-aurora-dsql-using-ai （ローカル: `/Users/konoken/ghq/github.com/aws-samples/sample-migration-aurora-dsql-using-ai`）— DMS + S3 経由のデータ移行パターン、スキーマ分析ワークフロー、Aurora DSQL MCP server の活用例。ソリューション自体は使わないが、プロンプト・スクリプト・ドキュメント構造が参考になる
- https://orm.drizzle.team/docs/migrate/migrate-from-prisma — Drizzle 公式の Prisma → Drizzle 移行ガイド。drizzle-kit introspect、クエリ変換パターン、relations() の定義方法

ゴール:
- Phase 0（バックアップ）から Phase E まで順序付きフェーズがあり、各フェーズに検証可能なチェックポイントがある
- Phase D が CDK デプロイ 3 回に分割されており、D-4 の前にユーザー確認を求める指示がある
- 既存の `docs/migration/v3-pnpm-workspaces-prompt.md` の内容が統合され、旧ファイルが削除されている

### 5. DESIGN_PRINCIPLES.md の更新

以下を更新:
- ADR セクション: 「ADRs are not used yet」を削除し、`docs/<version>/adr.md` の配置規約を記載。冒頭に intent 記録の方針を追記（design doc と ADR は意思決定だけでなく intent を記録する。AI 駆動開発では intent はコードより長命であり、モデルやワークフローが進化したとき intent から再生成する方が合理的な場合がある。ユーザーがファイルコピーではなく intent の追体験として再実装する利用形態を支える）
- Migration guides セクション: main ブランチ `87abeb9` の内容を参考に、新しい配置規約（`docs/<version>/migration-prompt.md`）で記述。AI agent 向けメタプロンプトとしての方針を記載。リベースは行わない（競合があるため、リベースは別タスクで実施）
- BREAKING CHANGE コミットフッターでのリンク規約を記載

ゴール:
- DESIGN_PRINCIPLES.md に `ADRs are not used yet` が含まれない
- DESIGN_PRINCIPLES.md に `docs/` と `migration-prompt` への言及がある
