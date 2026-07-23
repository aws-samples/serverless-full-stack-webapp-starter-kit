import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';
import { join } from 'node:path';
import { Database } from '../database';

/**
 * Timeout tiering. AWS Lambda's max per-invocation timeout is 15 minutes; the CDK
 * Trigger provider Lambda uses that as its own ceiling. We leave 1 minute of headroom
 * per layer so inner errors always surface before outer layers time out — otherwise
 * a hung migration would surface only as "custom resource timed out", swallowing the
 * real cause.
 */
const MIGRATION_RUNNER_TIMEOUT = Duration.minutes(13);
const TRIGGER_INVOCATION_TIMEOUT = Duration.minutes(14);

export interface DsqlMigratorProps {
  readonly database: Database;
}

export class DsqlMigrator extends Construct {
  constructor(scope: Construct, id: string, props: DsqlMigratorProps) {
    super(scope, id);

    const { database } = props;
    const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
    const migrationsDir = join(repoRoot, 'packages', 'db', 'migrations');
    const migrationRunner = new NodejsFunction(this, 'Handler', {
      entry: join(repoRoot, 'apps', 'db-migrator', 'src', 'handler.ts'),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: MIGRATION_RUNNER_TIMEOUT,
      environment: {
        DSQL_ENDPOINT: database.endpoint,
      },
      memorySize: 2048,
      logGroup: new LogGroup(this, 'Logs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      // Every dependency is inlined by esbuild on purpose — do not move packages to
      // `bundling.nodeModules`. That option installs them into the asset output, letting
      // package-manager metadata (absolute paths, install-time values) into the OUTPUT
      // asset hash: the known unstable-hash-in-CI class (aws/aws-cdk#15023). With full
      // inlining the staged output is only index.mjs + migrations/, hashed by content
      // (mtime-independent), verified byte-identical across fresh installs. `pg` is pure
      // JS; its optional native binding `pg-native` is externalized and absent at runtime.
      // Do not pass `assetHash` either: a curated input list can silently miss
      // runtime-relevant changes (the failure class that led to removing the former
      // migrations-hash machinery).
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        platform: 'node',
        externalModules: ['@aws-sdk/*', 'pg-native'],
        banner: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        commandHooks: {
          afterBundling: (_inputDir: string, outputDir: string): string[] => [
            `cp -R "${migrationsDir}" "${join(outputDir, 'migrations')}"`,
          ],
          beforeBundling: (): string[] => [],
          beforeInstall: (): string[] => [],
        },
      },
    });
    database.grantConnect(migrationRunner);

    const trigger = new Trigger(this, 'Trigger', {
      handler: migrationRunner,
      timeout: TRIGGER_INVOCATION_TIMEOUT,
    });
    trigger.node.addDependency(database.cluster);

    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
  }
}
