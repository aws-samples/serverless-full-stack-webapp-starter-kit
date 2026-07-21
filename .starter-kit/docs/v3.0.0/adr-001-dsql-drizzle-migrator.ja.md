# ADR-001: Aurora DSQL + Drizzle ORM + カスタムマイグレーションランナー

## ステータス

採択（v3.0.0）

## コンテキスト

v2 のアーキテクチャには3つの複合的な問題があった:

1. **VPC のコストと Aurora Serverless v2 の運用問題**: Aurora Serverless v2 は Lambda アクセスに VPC + NAT が必要。NAT Instance（t4g.nano, ~$3/月）と Bastion Host を含む VPC の運用コストに加え、セキュリティグループ、サブネット、Lambda 関数更新時の Hyperplane ENI アタッチ/デタッチ待ちといった運用オーバーヘッドがある。Aurora Serverless v2 はキットのユースケースにも適合しなかった: auto-pause（0 ACU）を設定しても24時間以上スリープ後のコールドスタートに 20–30秒かかりユーザー体験が悪い、5分間隔の定期ジョブで実質常時起動になり auto-pause の恩恵を受けられない、接続エラーのリトライ・エラー処理にかなりの開発コストがかかる。キットのコンセプトである「インフラコストの最小化とプロトタイプ開発を素早く始められることの両立」と適合しなかった。
2. **Prisma バイナリのオーバーヘッド**: `prisma generate` がプラットフォーム固有のクエリエンジンバイナリを生成。モノレポでは Prisma クライアントを import するパッケージごとに generate が必要。バイナリは Docker イメージを肥大化させ、クロスプラットフォームビルドを複雑にする。
3. **package.json の非分離**: `webapp/` に Next.js・非同期ジョブ・マイグレーションランナーが同居。`job.Dockerfile` は分かれていたが `package.json` が1つのため、`npm ci` で webapp の全依存（React, Next.js, aws-amplify 等）がインストールされイメージが膨張。`esbuild` の tree-shaking で `dependencies`/`devDependencies` を適切に分離すれば最終イメージの縮小は可能だが、ビルド時には一時的に全依存がインストールされることと、このビルド方法の認知負荷が問題だった。共有 DB コードをモノレポパッケージに抽出するには Prisma のバイナリ共有問題も同時に解決する必要がある。

これら3つの問題は依存チェーンを形成する: モノレポ構造の解決には Prisma 共有の解決が必要で、最もインパクトの大きい改善（VPC コストの排除）には DB エンジンの変更が必要であり、それにより ORM の選択も変わる。3つ同時に解決することで中間的な無駄を回避。

## 決定

**データベース: Aurora DSQL** — VPC 不要のサーバーレス分散 SQL データベース。Lambda はパブリックインターネット経由で IAM 認証接続。真の従量課金（read/write RPU）でトラフィックゼロ時のコストもゼロ。

**ORM: Drizzle ORM** — コード生成ステップのない純粋 TypeScript ORM。選択理由:

1. `prisma generate` もプラットフォーム固有バイナリも不要。スキーマ定義は通常の TypeScript ファイルで、ビルドステップなしにモノレポ内のパッケージ間で import 可能。
2. `relations()` は SQL レベルの外部キーを生成せずにクエリビルダー用のリレーションを定義し、DSQL の FK なし制約に自然に適合。
3. Prisma 7 は Rust → TypeScript へのアーキテクチャ移行中で、高並行の小クエリで性能低下が報告されている。このリスクを回避。

Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）だが、node-postgres 経由で動作する。

**マイグレーションランナー: カスタム実装** — drizzle-kit 組み込みのマイグレーションツールは DSQL と非互換:

- `drizzle-kit migrate`: 内部実装（dialect.ts）で全未適用マイグレーションを単一トランザクションにまとめて実行する。DSQL の1DDL/トランザクション制約と根本的に衝突。加えて、管理テーブルの作成に `SERIAL PRIMARY KEY` を使用しており、これも DSQL 非サポート。
- `drizzle-kit push`: DSQL 制約を考慮しない DDL を直接実行する。

Drizzle 公式ドキュメントの「Option 5」（drizzle-kit で SQL 生成、外部ツールで適用）に従い、Vercel の aws-dsql-movies-demo と同じアプローチを採用。ランナーは移植性のため3層構造（コアロジック / Lambda ハンドラー / CDK Construct）とした。CDK Construct はデプロイ時 Trigger でマイグレーションを自動実行し、`migrations/` の内容ハッシュで変更検知＝再実行を保証する（下記「結果」C1 を参照）。実装仕様は [design doc](design.ja.md#カスタムマイグレーションランナー) を参照。

### 却下した代替案

**データベース:**

- _Aurora Serverless v2（維持）_: VPC コスト、コールドスタート、定期ジョブでの常時起動問題が残る。接続エラーのリトライ処理の開発コストも解消されない。
- _DynamoDB_: テーブル設計のためにアクセスパターンの事前網羅が必要。Aurora Serverless v2 の SQL によるクエリ柔軟性と比較して、starter kit としての優位性がないと判断した。

**ORM:**

- _Prisma + aurora-dsql-prisma-tools_: `prisma generate` が必要でバイナリオーバーヘッドが残る。`@relation` は FK サポートを前提としており、aurora-dsql-prisma-tools で生成 SQL から FK 文を除去する必要がある。Prisma 7 の Rust → TypeScript アーキテクチャ移行がさらなる不確実性を生む。
- _Kysely_: 純粋 TypeScript クエリビルダーだが、Drizzle の `relations()` のような宣言的リレーション定義がない。手動での join 構築が必要。
- _生 SQL_: 型安全性なし。DB から React コンポーネントまでのエンドツーエンド型安全性というキットの目標に反する。

**マイグレーションランナー:**

- _drizzle-kit migrate_: 全マイグレーションを1トランザクションで実行 — DSQL の1DDL/トランザクション制約と根本的に非互換。
- _drizzle-kit push_: DSQL 制約を無視。
- _Flyway_: JVM 依存。Node.js/TypeScript プロジェクトに運用の複雑さを追加。（2026年2月に DSQL dialect サポートを追加したが、JVM 要件は残る。）

## 結果

- **DDL 制約の波及**: DSQL の制約がスキーマ設計、リントルール、マイグレーションツールに影響。主要制約: FK なし、SERIAL なし、1DDL/トランザクション、`CREATE INDEX ASYNC` 必須、ALTER TABLE は ADD COLUMN・RENAME・IDENTITY 操作・OWNER TO・SET SCHEMA のみ（DROP COLUMN、ALTER COLUMN TYPE、SET/DROP NOT NULL、SET/DROP DEFAULT、DROP CONSTRAINT は不可。ADD COLUMN も DEFAULT/NOT NULL/CHECK/UNIQUE/PRIMARY KEY を付けられない — nullable で追加し UPDATE でバックフィルする）。なお `json`/`jsonb` は当初非対応だったが 2026 年に DSQL がサポートを追加したため利用可（自動圧縮・ただし非インデックス。詳細は AGENTS.md / README を参照）。2層検出戦略（oxlint でスキーマ定義、SQL バリデーションで生成マイグレーション。後者は ADD COLUMN 制約や `ASYNC` 欠落も検出）が必要。DDL 制約の完全な一覧は [design doc](design.ja.md#ddl-制約) を参照。
- **マイグレーションランナーの保守**: カスタムランナーは追加の保守対象コード。ただしコアロジックは約200行で、包括的なテスト（unit + integration）を備える。
- **Drizzle DSQL サポートのギャップ**: Drizzle の DSQL 正式サポートは未リリース（drizzle-team/drizzle-orm#5248）。drizzle-kit generate は DSQL 制約を考慮しない — 出力には自動変換（`CREATE INDEX` → `CREATE INDEX ASYNC`、FK 除去）とバリデーションが必要。リスク緩和として2層の互換性チェックを導入。
- **スキーマ変更時のテーブル再作成**: DSQL の限定的な ALTER TABLE サポートにより、多くのスキーマ変更にはデータ移行を伴うテーブル再作成が必要。ランナーはバッチデータ操作用に `.sql` と `.mjs` のマイグレーションファイルをサポートする（`.ts` は非対応 — local と Lambda で同一ファイルを無変換で実行するため。詳細は [ADR-005](adr-005-migration-file-format.ja.md) を参照）。
- **マイグレーション状態管理**: `_migrations` テーブルは name（フルファイル名）+ executed_at のみで追跡。適用済みファイルの**内容ハッシュによる改竄検知**は不採用とした。フォーマッターやエディタが適用済みファイルを整形するとバイト列が変わり、ロジック無変更でも hash 不一致エラーになるため。適用済みファイルの改竄防止は git 管理で十分。これはデプロイ時再実行のための `migrations/` ディレクトリハッシュ（下記 C1）とは目的の異なる別機構である。
- **デプロイ時マイグレーション再実行の保証（C1）**: CDK Construct は `ContainerImageBuild`（デプロイ時ビルド）でイメージを作るため、イメージ内容ハッシュが synth 時に確定せず、CDK/CloudFormation の標準変更検知がマイグレーション変更を捉えられない。対策として migrator Construct は `migrations/` ディレクトリ全体の内容ハッシュを算出し、(1) `invalidateVersionBasedOn` で Lambda 公開バージョンを無効化、(2) CDK Trigger の `Custom::Trigger` プロパティに注入する。これにより「マイグレーション変更 → 新バージョン発行 → Trigger が最新を再実行」が保証される。ハッシュ対象はランナー実行対象（`.sql`/`.mjs`）の上位集合（ディレクトリ全体）とし、未ハッシュのファイル形式による無言スキップを構造的に排除する。拡張子リストを `packages/db` から import 共有する案は、`packages/db`（ESM）と CDK（ts-node の CommonJS）の境界で `require()` が `ERR_REQUIRE_ESM` になるため採らず、ディレクトリ全体ハッシュで代替した。
- **エラー回復戦略**: `check-dsql-compat` のエラー時に自動ロールバックは行わない。drizzle-kit の内部フォーマット（snapshot JSON）への依存を避けるため、ユーザーが `git checkout -- migrations/` で明示的に戻す方式とした。

### Vercel デモ（aws-dsql-movies-demo）との差分

| 機能                      | Vercel デモ                          | 本 migrator                                                                                     |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 管理テーブル              | `migrations` (id, name, executed_at) | `_migrations` (name, executed_at)                                                               |
| hash 検証                 | なし                                 | 内容ハッシュ改竄検知は不採用（別途デプロイ時再実行用に migrations/ ディレクトリハッシュを使用） |
| drizzle-kit generate      | 使用しない（手書き SQL）             | 使用する（出力を自動変換）                                                                      |
| SQL 自動変換              | なし                                 | statement-breakpoint → 空行、INDEX → ASYNC、FK 除去                                             |
| SQL バリデーション        | なし                                 | ALTER COLUMN TYPE, DROP COLUMN 等の検出                                                         |
| 実行環境                  | CLI のみ                             | CLI + Lambda（CDK Trigger）                                                                     |
| 接続方式                  | Vercel OIDC                          | IAM 認証（Lambda 実行ロール / AWS プロファイル）                                                |
| `already exists` スキップ | あり                                 | あり                                                                                            |
