# ADR-004: DSQL admin ロールの維持

## ステータス

採択（v3.0.0）

## コンテキスト

Aurora DSQL は2種類のデータベースロールを提供する:

- **admin ロール**: IAM アクション `dsql:DbConnectAdmin` で接続。DDL + DML + ロール管理の全権限を持つ。クラスタ作成時に自動生成される唯一の組み込みロール
- **カスタムロール**: IAM アクション `dsql:DbConnect` で接続。`admin` で `CREATE ROLE ... WITH LOGIN` → `AWS IAM GRANT <role> TO '<IAM ARN>'` → `GRANT ... ON ALL TABLES IN SCHEMA` で作成する。付与された DML 権限のみ実行可能

`@aws/aurora-dsql-node-postgres-connector` は接続時の `user` パラメータでトークン種別を決定する:

```js
if (user === "admin") token = await signer.getDbConnectAdminAuthToken();
else token = await signer.getDbConnectAuthToken();
```

現状、全 Lambda（webapp、async-job、migrator）が `user: 'admin'` + `dsql:DbConnectAdmin` で接続している。最小権限の原則に従えば、ランタイム（webapp、async-job）は DML のみのカスタムロールに分離すべきである。

v2（Aurora Serverless v2）でも同様にマスターユーザー（`admin`）で全 Lambda が接続していた。v2 では Secrets Manager のパスワードを Lambda 環境変数に渡す方式だったため、v3 の IAM 一時トークン方式は認証レイヤーとしては改善されている。

### admin ロールのセキュリティリスク

admin ロールは DML に加えて DDL（`CREATE/DROP/ALTER TABLE`、`CREATE/DROP INDEX`）とロール管理（`CREATE ROLE`、`AWS IAM GRANT`）を実行できる。アプリケーションの脆弱性（SQL インジェクション等）を通じて DDL が実行された場合、テーブル削除によるデータ喪失や、任意の IAM ロールへの DB アクセス付与が可能になる。

カスタムロールであれば、被害は GRANT された DML 操作（データの読み取り・変更・削除）に限定される。

本キットでは Drizzle ORM がクエリをパラメータ化するため、SQL インジェクションの成立には ORM のパラメータ化のバイパスが必要であり、現実的なリスクは低い。ただし defense in depth の観点では、カスタムロール分離は有効な追加防御層である。

### カスタムロール導入に必要な作業

カスタムロールの導入自体は以下の手順で実現可能:

1. マイグレーションで `CREATE ROLE app WITH LOGIN` + `AWS IAM GRANT app TO '<Lambda実行ロールARN>'`
2. マイグレーション後に `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app` を実行（`ON ALL TABLES` で既存テーブル全体に一括付与）
3. `client.ts` の `user: 'admin'` を `user: 'app'` に変更
4. CDK の IAM ポリシーを `dsql:DbConnectAdmin` → `dsql:DbConnect` に変更

GRANT 管理は `ON ALL TABLES IN SCHEMA` で一括付与できるため、テーブルごとの個別 GRANT は不要。ただし DSQL は `ALTER DEFAULT PRIVILEGES` を[サポートしていない](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html)ため、テーブル追加を含むマイグレーションのたびに GRANT の再実行が必要（マイグレーションランナー末尾に1行追加で自動化可能）。

## 決定

v3.0.0 では全 Lambda で `admin` ロールを維持する。

カスタムロールへの分離を見送る主な理由:

1. **CDK → マイグレーション間の順序依存**: カスタムロールの `AWS IAM GRANT` には Lambda 実行ロールの ARN が必要。CDK でロールを作成 → マイグレーションで IAM マッピング → という順序依存が生じ、初回デプロイのブートストラップが複雑になる
2. **v2 からの継続**: v2 でもマスターユーザーで全接続しており、v3 で IAM 一時トークンに移行したことで認証レイヤーは改善済み。ロール分離は追加の改善であり、v3 のスコープとしては優先度が低い

### 却下した代替案

- _カスタムロール分離_: GRANT 管理自体は `ON ALL TABLES` で簡素化できるが、CDK → マイグレーション間の順序依存がスターターキットの「コピーして育てる」コンセプトに見合わない。本番プロダクトに育てる段階で導入を検討すべき
- _migrator のみ admin、ランタイムはカスタムロール_: 部分的な分離でも IAM マッピングのブートストラップ問題は同じ

## 結果

- webapp と async-job の Lambda は DDL 実行権限を持つ。SQL インジェクション等の脆弱性を通じてスキーマ変更やロール操作が実行されるリスクがある（Drizzle ORM のパラメータ化により現実的なリスクは低い）
- 本番ワークロードでは [DSQL のカスタムデータベースロール](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html) を使用した最小権限への移行を推奨する。上記「カスタムロール導入に必要な作業」を参照
- CDK の `Database.grantConnect()` メソッドは将来の分離に備えて `grantConnect`（DML）/ `grantConnectAdmin`（DDL）への分割が可能な設計になっている
