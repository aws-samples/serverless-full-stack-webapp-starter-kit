# ADR-004: Retaining the DSQL admin role

## Status

Accepted (v3.0.0)

## Context

Aurora DSQL provides two types of database roles:

- **admin role**: Connects with the IAM action `dsql:DbConnectAdmin`. It has all privileges for DDL + DML + role management. It is the only built-in role, automatically created when the cluster is created.
- **custom role**: Connects with the IAM action `dsql:DbConnect`. Create it with `admin` using `CREATE ROLE ... WITH LOGIN` → `AWS IAM GRANT <role> TO '<IAM ARN>'` → `GRANT ... ON ALL TABLES IN SCHEMA`. It can perform only the granted DML privileges.

`@aws/aurora-dsql-node-postgres-connector` determines the token type from the `user` parameter at connection time:

```js
if (user === "admin") token = await signer.getDbConnectAdminAuthToken();
else token = await signer.getDbConnectAuthToken();
```

Currently, all Lambda functions (webapp, async-job, migrator) connect with `user: 'admin'` + `dsql:DbConnectAdmin`. Following the principle of least privilege, runtime functions (webapp, async-job) should be separated into a custom role with DML privileges only.

In v2 (Aurora Serverless v2), all Lambda functions also connected with the primary user (`admin`). In v2, the password from Secrets Manager was passed to Lambda environment variables, so the v3 IAM temporary token approach improves the authentication layer.

### Security risks of the admin role

In addition to DML, the admin role can perform DDL (`CREATE/DROP/ALTER TABLE`, `CREATE/DROP INDEX`) and role management (`CREATE ROLE`, `AWS IAM GRANT`). If DDL is executed through an application vulnerability (such as SQL injection), it can cause data loss by dropping tables or grant database access to arbitrary IAM roles.

With a custom role, the impact is limited to granted DML operations (reading, modifying, and deleting data).

In this kit, Drizzle ORM parameterizes queries, so SQL injection requires bypassing ORM parameterization and the practical risk is low. However, from a defense in depth perspective, custom role separation is an effective additional layer of protection.

### Work required to introduce custom roles

Custom roles can be introduced with the following steps:

1. In a migration, run `CREATE ROLE app WITH LOGIN` + `AWS IAM GRANT app TO '<Lambda execution role ARN>'`
2. After the migration, run `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app` (`ON ALL TABLES` grants privileges to all existing tables at once)
3. Change `user: 'admin'` in `client.ts` to `user: 'app'`
4. Change the CDK IAM policy from `dsql:DbConnectAdmin` → `dsql:DbConnect`

`GRANT ... ON ALL TABLES IN SCHEMA` grants privileges on all existing tables at once, so individual GRANTs for each table are unnecessary. However, because DSQL does [not support](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html) `ALTER DEFAULT PRIVILEGES`, GRANTs must be run again with every migration that adds tables (this can be automated by adding one line at the end of the migration runner).

## Decision

In v3.0.0, retain the `admin` role for all Lambda functions.

The primary reasons for deferring separation into custom roles are:

1. **Ordering dependency between CDK and migrations**: A custom role's `AWS IAM GRANT` requires the Lambda execution role ARN. This creates an ordering dependency: create the role in CDK → create the IAM mapping in a migration. This complicates the bootstrap for the initial deployment.
2. **Continuation from v2**: In v2, all connections also used the primary user, and moving to IAM temporary tokens in v3 has already improved the authentication layer. Role separation is an additional improvement and has lower priority for the v3 scope.

### Rejected alternatives

- _Custom role separation_: Although `ON ALL TABLES` simplifies GRANT management, the ordering dependency between CDK and migrations does not fit the starter kit's "copy and grow" concept. Consider introducing it when growing into a production product.
- _Only the migrator uses admin; runtime functions use a custom role_: The IAM mapping bootstrap issue remains the same even with partial separation.

## Consequences

- The webapp and async-job Lambda functions have privileges to execute DDL. There is a risk that schema changes or role operations could be executed through vulnerabilities such as SQL injection (the practical risk is low because Drizzle ORM parameterizes queries).
- For production workloads, recommend moving to the principle of least privilege using [DSQL custom database roles](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/using-database-and-iam-roles.html). See "Work required to introduce custom roles" above.
- CDK's `Database.grantConnect()` method is designed to allow a future split into `grantConnect` (DML) / `grantConnectAdmin` (DDL) in preparation for separation.
