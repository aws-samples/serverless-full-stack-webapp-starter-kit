import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface AsyncJobProps {
  readonly database: ITable;
}

export class AsyncJob extends Construct {
  readonly queue: Queue;
  constructor(scope: Construct, id: string, props: AsyncJobProps) {
    super(scope, id);
    const { database } = props;

    const visibilityTimeout = Duration.minutes(10);

    const queue = new Queue(this, 'Queue', {
      visibilityTimeout,
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset('../backend', { cmd: ['handler-job.handler'] }),
      memorySize: 256,
      timeout: visibilityTimeout,
      environment: {
        TABLE_NAME: database.tableName,
      },
      reservedConcurrentExecutions: 1,
    });

    database.grantReadWriteData(handler);
    handler.addEventSource(new SqsEventSource(queue, { maxBatchingWindow: Duration.seconds(5) }));

    this.queue = queue;
  }
}
