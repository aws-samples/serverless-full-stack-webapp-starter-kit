# ADR-001: Aurora DSQL + Drizzle ORM + カスタムマイグレーションランナー

## ステータス

採択（v3.0.0）

## コンテキスト

v2 のアーキテクチャには3つの複合的な問題があった:

1. **VPC のコストと Aurora Serverless v2 の運用問題**: Aurora Serverless v2 は Lambda アクセスに VPC + NAT が必要。NAT Instance（t4g.nano, ~$3/月）と Bastion Host を含む VPC の運用コストに加え、セキュリティグループ、サブネット、デプロイ変更時の Lambda Hyperplane ENI ライフサイクル問題といった運用オーバーヘッドがある。Aurora Serverless v2 自体にも問題があった: 最小 0.5 ACU の課金（~$43/月）、コールドスタートに 20–30秒かかるケースがありユーザー体験が悪い、5分間隔の定期ジョブで実質常時起動になる、接続エラーのリトライ・エラー処理にかなりの開発コストがかかる。
2. **Prisma バイナリのオーバーヘッド**: `prisma generate` がプラットフォーム固有のクエリエンジンバイナリを生成。モノレポでは Prisma クライアントを import するパッケージごとに generate が必要。バイナリは Docker イメージを肥大化させ、クロスプラットフォームビルドを複雑にする。
3. **package.json の非分離**: `webapp/` に Next.js・非同期ジョブ・マイグレーションランナーが同居。`job.Dockerfile` は分かれていたが `package.json` が1つのため、`npm ci` で webapp の全依存（React, Next.js, aws-amplify 等）がインストールされイメージが膨張。共有 DB コードをモノレポパッケージに抽出するには Prisma のバイナリ共有問題も同時に解決する必要がある。

これら3つの問題は依存チェーンを形成する: モノレポ構造の解決には Prisma 共有の解決が必要で、最もインパクトの大きい改善（VPC コストの排除）には DB エンジンの変更が必要であり、それにより ORM の選択も変わる。3つ同時に解決することで中間的な無駄を回避。

## 決定

**データベース: Aurora DSQL** — VPC 不要のサーバーレス分散 SQL データベース。Lambda はパブリックインターネット経由で IAM 認証接続。真の従量課金（read/write RPU）でトラフィックゼロ時のコストもゼロ。

**ORM: Drizzle ORM** — コード生成ステップのない純粋 TypeScript ORM。選択理由:

1. `prisma generate` もプラットフォーム固有バイナリも不要。スキーマ定義は通常の TypeScript ファイルで、ビルドステップなしにモノレポ内のパッケージ間で import 可能。
2. `relations()` は SQL レベルの外部キーを生成せずにクエリビルダー用のリレーションを定義し、DSQL の FK なし制約に自然に適合。
3. Prisma 7 は Rust → TypeScript へのアーキテクチャ移行中で、高並行の小クエリで性能低下が報告されている。このリスクを回避。

Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）だが、node-postgres 経由で動作する。

**マイグレーションランナー: カスタム実装** — drizzle-kit 組み込みのマイグレーションツールは DSQL と非互換:

- `drizzle-kit migrate`: 内部実装（dialect.ts）で全未適用マイグレーションを単一トランザクションにまとめて実行する。DSQL の1DDL/トランザクション制約と根本的に衝突。
- `drizzle-kit push`: DSQL 制約を考慮しない DDL を直接実行する。

Drizzle 公式ドキュメントの「Option 5」（drizzle-kit で SQL 生成、外部ツールで適用）に従い、Vercel の aws-dsql-movies-demo と同じアプローチを採用。ランナーは移植性のため3層構造（コアロジック / Lambda ハンドラー / CDK Construct）とした。実装仕様は [design doc](design.ja.md#カスタムマイグレーションランナー) を参照。

### 却下した代替案

**データベース:**

- _Aurora Serverless v2（維持）_: VPC コスト、コールドスタート、定期ジョブでの常時起動問題が残る。接続エラーのリトライ処理の開発コストも解消されない。
- _DynamoDB_: シングルテーブル設計の学習曲線が急。SQL はキットの対象読者（サーバーレス初心者の開発者）にとってよりアクセスしやすい。

**ORM:**

- _Prisma + aurora-dsql-prisma-tools_: `prisma generate` が必要でバイナリオーバーヘッドが残る。`@relation` は FK サポートを前提としており、aurora-dsql-prisma-tools で生成 SQL から FK 文を除去する必要がある。Prisma 7 の Rust → TypeScript アーキテクチャ移行がさらなる不確実性を生む。
- _Kysely_: 純粋 TypeScript クエリビルダーだが、Drizzle の `relations()` のような宣言的リレーション定義がない。手動での join 構築が必要。
- _生 SQL_: 型安全性なし。DB から React コンポーネントまでのエンドツーエンド型安全性というキットの目標に反する。

**マイグレーションランナー:**

- _drizzle-kit migrate_: 全マイグレーションを1トランザクションで実行 — DSQL の1DDL/トランザクション制約と根本的に非互換。
- _drizzle-kit push_: DSQL 制約を無視。
- _Flyway_: JVM 依存。Node.js/TypeScript プロジェクトに運用の複雑さを追加。（2026年2月に DSQL dialect サポートを追加したが、JVM 要件は残る。）

## 結果

- **DDL 制約の波及**: DSQL の制約（FK なし、SERIAL なし、JSON/JSONB なし、ALTER TABLE 制限）がスキーマ設計、リントルール、マイグレーションツールに影響。2層検出戦略（oxlint でスキーマ定義、SQL バリデーションで生成マイグレーション）が必要。DSQL の DDL 制約一覧は [design doc](design.ja.md#ddl-制約) を参照。
- **マイグレーションランナーの保守**: カスタムランナーは追加の保守対象コード。ただしコアロジックは約200行で、包括的なテスト（unit + integration）を備える。
- **Drizzle DSQL サポートのギャップ**: Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）。drizzle-kit generate は DSQL 制約を考慮しない — 出力には自動変換（`CREATE INDEX` → `CREATE INDEX ASYNC`、FK 除去）とバリデーションが必要。リスク緩和として2層の互換性チェックを導入。
- **スキーマ変更時のテーブル再作成**: DSQL の限定的な ALTER TABLE サポートにより、多くのスキーマ変更にはデータ移行を伴うテーブル再作成が必要。ランナーはバッチデータ操作用の `.ts` マイグレーションファイルをサポート。
- **マイグレーション状態管理**: `_migrations` テーブルは name + executed_at のみで追跡。hash 検証（ファイル内容のハッシュ値による改竄検知）は不採用とした。フォーマッターやエディタが適用済みファイルを整形するとバイト列が変わり、ロジック無変更でも hash 不一致エラーになるため。適用済みファイルの改竄防止は git 管理で十分。
- **エラー回復戦略**: `check-dsql-compat` のエラー時に自動ロールバックは行わない。drizzle-kit の内部フォーマット（snapshot JSON）への依存を避けるため、ユーザーが `git checkout -- migrations/` で明示的に戻す方式とした。

### Vercel デモ（aws-dsql-movies-demo）との差分

| 機能                      | Vercel デモ                          | 本 migrator                                         |
| ------------------------- | ------------------------------------ | --------------------------------------------------- |
| 管理テーブル              | `migrations` (id, name, executed_at) | `_migrations` (name, executed_at)                   |
| hash 検証                 | なし                                 | なし（上記の理由で不採用）                          |
| drizzle-kit generate      | 使用しない（手書き SQL）             | 使用する（出力を自動変換）                          |
| SQL 自動変換              | なし                                 | statement-breakpoint → 空行、INDEX → ASYNC、FK 除去 |
| SQL バリデーション        | なし                                 | ALTER COLUMN TYPE, DROP COLUMN 等の検出             |
| 実行環境                  | CLI のみ                             | CLI + Lambda（CDK Trigger）                         |
| 接続方式                  | Vercel OIDC                          | IAM 認証（Lambda 実行ロール / AWS プロファイル）    |
| `already exists` スキップ | あり                                 | あり                                                |
