# ADR-004: DSQL admin ロールの維持

## ステータス

採択（v3.0.0）

## コンテキスト

Aurora DSQL は2種類のデータベースロールを提供する:

- **admin ロール**: IAM アクション `dsql:DbConnectAdmin` で接続。DDL + DML の全権限を持つ。クラスタ作成時に自動生成される唯一の組み込みロール
- **カスタムロール**: IAM アクション `dsql:DbConnect` で接続。DML のみ。`admin` で `CREATE ROLE ... WITH LOGIN` → `AWS IAM GRANT <role> TO '<IAM ARN>'` → テーブルごとの `GRANT` で作成する

`@aws/aurora-dsql-node-postgres-connector` は接続時の `user` パラメータでトークン種別を決定する:

```js
if (user === "admin") token = await signer.getDbConnectAdminAuthToken();
else token = await signer.getDbConnectAuthToken();
```

現状、全 Lambda（webapp、async-job、migrator）が `user: 'admin'` + `dsql:DbConnectAdmin` で接続している。最小権限の原則に従えば、ランタイム（webapp、async-job）は DML のみのカスタムロールに分離すべきである。

## 決定

v3.0.0 では全 Lambda で `admin` ロールを維持する。

カスタムロールへの分離は以下の理由で見送る:

1. **GRANT 管理の複雑さ**: テーブル追加のたびにマイグレーションで `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO <role>` が必要。`ALTER DEFAULT PRIVILEGES` の DSQL 対応状況が未確認で、対応していない場合は全マイグレーションに手動で GRANT 文を追加する運用になる
2. **CDK → マイグレーション間の循環的依存**: カスタムロールの `AWS IAM GRANT` には Lambda 実行ロールの ARN が必要。CDK でロールを作成 → マイグレーションで IAM マッピング → という順序依存が生じ、初回デプロイのブートストラップが複雑になる
3. **リスクの限定性**: 認証は IAM 一時トークン（15分有効期限、自動リフレッシュ）で保護されている。Lambda 実行ロールの IAM ポリシーは対象クラスタの ARN にスコープされており、他のクラスタへのアクセスは不可。admin ロールによる追加リスクは「Lambda 内のコードが意図しない DDL を実行する可能性」に限定される

### 却下した代替案

- _カスタムロール分離_: 上記1–2の複雑さがスターターキットの「コピーして育てる」コンセプトに見合わない。本番プロダクトに育てる段階で導入を検討すべき
- _migrator のみ admin、ランタイムはカスタムロール_: 部分的な分離でも GRANT 管理と IAM マッピングの複雑さは同じ

## 結果

- webapp と async-job の Lambda は DDL 実行権限を持つ。アプリケーションコードのバグにより意図しないスキーマ変更が実行されるリスクがある
- 本番ワークロードでは [DSQL のカスタムデータベースロール](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html) を使用した最小権限への移行を推奨する
- CDK の `Database.grantConnect()` メソッドは将来の分離に備えて `grantConnect`（DML）/ `grantConnectAdmin`（DDL）への分割が可能な設計になっている
