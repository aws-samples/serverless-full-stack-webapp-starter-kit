import { Construct } from 'constructs';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { Rule, RuleTargetInput, Schedule } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';

export interface CronJobsProps {
  readonly database: ITable;
  readonly jobQueue: IQueue;
}

export class CronJobs extends Construct {
  private readonly handler: DockerImageFunction;

  constructor(scope: Construct, id: string, props: CronJobsProps) {
    super(scope, id);
    const { database, jobQueue } = props;

    this.handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset('../backend', { cmd: ['handler-cron-job.handler'] }),
      memorySize: 256,
      environment: {
        TABLE_NAME: database.tableName,
        JOB_QUEUE_NAME: jobQueue.queueName,
      },
    });

    database.grantReadWriteData(this.handler);
    jobQueue.grantSendMessages(this.handler);

    // Add new cron jobs here
    // Please refer to the below document for defining cron schedule
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.Schedule.html
    // NOTE: All the cron schedules must be in UTC.
    this.addRule('SampleJob', Schedule.cron({ minute: '0', hour: '0', day: '1' }));
  }

  private addRule(jobType: string, schedule: Schedule, payload?: any) {
    return new Rule(this, jobType, {
      schedule,
      targets: [
        new targets.LambdaFunction(this.handler, {
          retryAttempts: 3,
          event: RuleTargetInput.fromObject({
            jobType,
            payload,
          }),
        }),
      ],
    });
  }
}
