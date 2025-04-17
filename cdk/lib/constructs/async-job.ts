import { Construct } from 'constructs';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import { Architecture, DockerImageCode, DockerImageFunction, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { Database } from './database';
import { EventBus } from './event-bus';

export interface AsyncJobProps {
  readonly database: Database;
  readonly eventBus: EventBus;
}

export class AsyncJob extends Construct {
  readonly handler: IFunction;

  constructor(scope: Construct, id: string, props: AsyncJobProps) {
    super(scope, id);
    const { database, eventBus } = props;

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset('../webapp', {
        cmd: ['async-job-runner.handler'],
        platform: Platform.LINUX_ARM64,
        file: 'job.Dockerfile',
      }),
      memorySize: 256,
      timeout: Duration.minutes(10),
      architecture: Architecture.ARM_64,
      environment: {
        ...database.getLambdaEnvironment('main'),
        EVENT_HTTP_ENDPOINT: eventBus.httpEndpoint,
      },
      vpc: database.cluster.vpc,
      // limit concurrency to mitigate any possible EDoS attacks
      reservedConcurrentExecutions: 1,
    });

    handler.connections.allowToDefaultPort(database);
    eventBus.api.grantPublish(handler);

    new CfnOutput(this, 'HandlerArn', { value: handler.functionArn });
    this.handler = handler;
  }
}
