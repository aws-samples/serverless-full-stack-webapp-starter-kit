import { CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageFunction, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Database } from '../database';
import { join } from 'path';
import { ContainerImageBuild } from '@cdklabs/deploy-time-build';

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
      file: 'apps/cdk/lib/constructs/dsql-migrator/Dockerfile',
      ignoreMode: IgnoreMode.DOCKER,
    });

    const migrationRunner = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(15),
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

    const trigger = new Trigger(this, 'Trigger', {
      handler: migrationRunner,
    });
    trigger.node.addDependency(database.cluster);

    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
  }
}
