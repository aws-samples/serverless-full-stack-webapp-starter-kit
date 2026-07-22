import { CfnOutput, CfnResource, Duration, IgnoreMode, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Architecture, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Trigger } from 'aws-cdk-lib/triggers';
import { ContainerImageBuild } from '@cdklabs/deploy-time-build';
import { Construct } from 'constructs';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * Hash every file under migrations/ (recursively).
 * `ContainerImageBuild` builds the image at deploy time, so its content hash is unknown
 * at synth — CDK's normal change detection can't see migration changes. Injecting this
 * hash forces a Lambda version bump + Trigger re-fire whenever migrations change.
 *
 * We hash the WHOLE directory rather than a filtered extension set: the files the runner
 * executes (.sql/.mjs, per ADR-005) are always a subset, so the hash can never miss a
 * change to an executed migration (the bug where a newly-added .mjs was left un-hashed
 * and silently skipped). Extra files (e.g. meta/ snapshots) only cause harmless extra
 * invalidation.
 */
function computeMigrationHash(migrationsDir: string): string {
  const entries = readdirSync(migrationsDir, { recursive: true, encoding: 'utf-8' }).sort();
  const hash = createHash('sha256');
  for (const entry of entries) {
    const full = join(migrationsDir, entry);
    if (!statSync(full).isFile()) continue;
    hash.update(entry);
    hash.update(readFileSync(full));
  }
  return hash.digest('hex');
}

export interface DsqlMigratorProps {
  readonly database: Database;
}

export class DsqlMigrator extends Construct {
  constructor(scope: Construct, id: string, props: DsqlMigratorProps) {
    super(scope, id);

    const { database } = props;

    const image = new ContainerImageBuild(this, 'Build', {
      directory: join(__dirname, '..', '..', '..', '..', '..'),
      platform: Platform.LINUX_ARM64,
      file: 'apps/db-migrator/Dockerfile',
      ignoreMode: IgnoreMode.DOCKER,
    });

    const migrationRunner = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
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
    });
    database.grantConnect(migrationRunner);

    const migrationsDir = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'migrations');
    const migrationHash = computeMigrationHash(migrationsDir);

    // Deploy-time image builds hide content changes from CDK. Force a new published
    // Lambda version whenever migrations change. Because `Trigger`'s `HandlerArn` is
    // `handler.currentVersion.functionArn`, the Custom Resource implicitly depends on
    // the new Version — and CFN's `AWS::Lambda::Version` requires `LastUpdateStatus=
    // Successful` before publishing, so the new image must be fully loaded before the
    // trigger can invoke it. This is the sync barrier that closes the container-init
    // race described in issue #229.
    migrationRunner.invalidateVersionBasedOn(migrationHash);

    const trigger = new Trigger(this, 'Trigger', {
      handler: migrationRunner,
      timeout: TRIGGER_INVOCATION_TIMEOUT,
    });
    trigger.node.addDependency(database.cluster);

    // Inject the same hash as a Custom::Trigger property so a migration change is a
    // property change → the trigger re-fires on redeploy.
    const triggerResource = trigger.node.findChild('Default').node.defaultChild as CfnResource;
    triggerResource.addPropertyOverride('MigrationHash', migrationHash);

    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
  }
}
