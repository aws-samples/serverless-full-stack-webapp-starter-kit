import { Construct } from 'constructs';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { HttpUserPoolAuthorizer } from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
import { DockerImageCode, DockerImageFunction } from 'aws-cdk-lib/aws-lambda';
import { CorsHttpMethod, HttpApi, HttpMethod } from '@aws-cdk/aws-apigatewayv2-alpha';
import { Auth } from './auth';
import { IQueue } from 'aws-cdk-lib/aws-sqs';

export interface BackendApiProps {
  readonly database: ITable;
  readonly corsAllowOrigins?: string[];
  readonly auth: Auth;
  readonly jobQueue: IQueue;
}

export class BackendApi extends Construct {
  readonly api: HttpApi;
  constructor(scope: Construct, id: string, props: BackendApiProps) {
    super(scope, id);

    const { database, jobQueue, corsAllowOrigins: allowOrigins = ['*'] } = props;

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset('../backend'),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: database.tableName,
        CORS_ALLOW_ORIGINS: allowOrigins.join(','),
        JOB_QUEUE_NAME: jobQueue.queueName,
      },
    });

    database.grantReadWriteData(handler);
    jobQueue.grantSendMessages(handler);

    const handlerPublic = new DockerImageFunction(this, 'HandlerPublic', {
      code: DockerImageCode.fromImageAsset('../backend', { cmd: ['handler-public.handler'] }),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: database.tableName,
        CORS_ALLOW_ORIGINS: allowOrigins.join(','),
      },
    });
    database.grantReadWriteData(handlerPublic);

    const api = new HttpApi(this, 'Default', {
      corsPreflight: {
        allowHeaders: ['*'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.HEAD,
          CorsHttpMethod.OPTIONS,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
        ],
        allowOrigins: allowOrigins,
        maxAge: Duration.days(10),
      },
      
    });

    {
      const integration = new HttpLambdaIntegration('Integration', handler);
      const authorizer = new HttpUserPoolAuthorizer('Authorizer', props.auth.userPool, {
        userPoolClients: [props.auth.client],
      });
      api.addRoutes({
        path: '/{proxy+}',
        integration,
        authorizer,
        methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      });
    }

    {
      const integration = new HttpLambdaIntegration('PublicIntegration', handlerPublic);
      api.addRoutes({
        path: '/public/{proxy+}',
        integration,
        methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      });
    }

    this.api = api;

    new CfnOutput(this, 'BackendApiUrl', { value: api.apiEndpoint });
  }
}
