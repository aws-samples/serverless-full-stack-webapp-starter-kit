import { Construct } from 'constructs';
import { CfnOutput, Duration, IgnoreMode, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Architecture, DockerImageFunction, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Database } from './database';
import { EventBus } from './event-bus';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke } from 'aws-cdk-lib/aws-scheduler-targets';
import { ContainerImageBuild } from '@cdklabs/deploy-time-build';

export interface AsyncJobProps {
  readonly database: Database;
  readonly eventBus: EventBus;
}

export class AsyncJob extends Construct {
  readonly handler: IFunction;

  constructor(scope: Construct, id: string, props: AsyncJobProps) {
    super(scope, id);
    const { database, eventBus } = props;

    const image = new ContainerImageBuild(this, 'Build', {
      directory: join('..', '..'),
      platform: Platform.LINUX_ARM64,
      file: 'apps/async-job/Dockerfile',
      ignoreMode: IgnoreMode.DOCKER,
    });

    const handler = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
      memorySize: 256,
      timeout: Duration.minutes(10),
      architecture: Architecture.ARM_64,
      environment: {
        DSQL_ENDPOINT: database.endpoint,
        EVENT_HTTP_ENDPOINT: eventBus.httpEndpoint,
      },
      // limit concurrency to mitigate any possible EDoS attacks
      reservedConcurrentExecutions: 1,
      logGroup: new LogGroup(this, 'HandlerLogs', {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    database.grantConnect(handler);
    eventBus.api.grantPublish(handler);

    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['translate:TranslateText', 'comprehend:DetectDominantLanguage'],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'HandlerArn', { value: handler.functionArn });
    this.handler = handler;

    // Example scheduled job — runs on the 1st of every month at 00:00 UTC.
    // Replace or remove when adding your own scheduled jobs.
    this.addSchedule(
      'ExampleJob',
      ScheduleExpression.cron({ minute: '0', hour: '0', day: '1', timeZone: TimeZone.ETC_UTC }),
      { type: 'example' },
    );
  }

  /**
   * Add an EventBridge Scheduler entry that invokes the async-job Lambda with `payload`.
   * `payload` must satisfy `jobPayloadPropsSchema` in `@repo/shared-types/job-payload`
   * (a Zod discriminated union on `type`); the handler parses it at runtime and
   * dispatches to the matching job. The Schedule construct id (`scheduleId`) becomes
   * part of the CFN logical id, so choose a stable name.
   */
  public addSchedule(scheduleId: string, schedule: ScheduleExpression, payload: Record<string, unknown>) {
    return new Schedule(this, scheduleId, {
      schedule,
      target: new LambdaInvoke(this.handler, {
        input: ScheduleTargetInput.fromObject(payload),
        retryAttempts: 5,
      }),
    });
  }
}
