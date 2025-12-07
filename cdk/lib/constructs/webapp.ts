import { IgnoreMode, Duration, CfnOutput, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageFunction, DockerImageCode, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { CloudFrontLambdaFunctionUrlService } from './cf-lambda-furl-service/service';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Database } from './database';
import { EdgeFunction } from './cf-lambda-furl-service/edge-function';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Auth } from './auth/';
import { ContainerImageBuild } from 'deploy-time-build';
import { join } from 'path';
import { EventBus } from './event-bus/';
import { AsyncJob } from './async-job';
import { Trigger } from 'aws-cdk-lib/triggers';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

export interface WebappProps {
  database: Database;
  signPayloadHandler: EdgeFunction;
  accessLogBucket: Bucket;
  auth: Auth;
  eventBus: EventBus;
  asyncJob: AsyncJob;

  /**
   * Route 53 hosted zone for custom domain.
   *
   * @default No custom domain. The webapp will use CloudFront's default domain (e.g., d1234567890.cloudfront.net).
   */
  hostedZone?: IHostedZone;
  /**
   * ACM certificate for custom domain (must be in us-east-1 for CloudFront).
   *
   * @default No custom domain.
   */
  certificate?: ICertificate;
  /**
   * Subdomain name for the webapp. If not specified, the root domain will be used.
   *
   * @default Use root domain
   */
  subDomain?: string;
}

export class Webapp extends Construct {
  public readonly baseUrl: string;

  constructor(scope: Construct, id: string, props: WebappProps) {
    super(scope, id);

    const { database, hostedZone, auth, subDomain, eventBus, asyncJob } = props;

    // Use ContainerImageBuild to inject deploy-time values in the build environment
    const image = new ContainerImageBuild(this, 'Build', {
      directory: join('..', 'webapp'),
      platform: Platform.LINUX_ARM64,
      ignoreMode: IgnoreMode.DOCKER,
      exclude: readFileSync(join('..', 'webapp', '.dockerignore'))
        .toString()
        .split('\n'),
      tagPrefix: 'webapp-starter-',
      buildArgs: {
        ALLOWED_ORIGIN_HOST: hostedZone ? `*.${hostedZone.zoneName}` : '*.cloudfront.net',
        SKIP_TS_BUILD: 'true',
        NEXT_PUBLIC_EVENT_HTTP_ENDPOINT: eventBus.httpEndpoint,
        NEXT_PUBLIC_AWS_REGION: Stack.of(this).region,
      },
    });

    const handler = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
      timeout: Duration.minutes(3),
      environment: {
        ...database.getLambdaEnvironment('main'),
        COGNITO_DOMAIN: auth.domainName,
        USER_POOL_ID: auth.userPool.userPoolId,
        USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
        ASYNC_JOB_HANDLER_ARN: asyncJob.handler.functionArn,
      },
      vpc: database.cluster.vpc,
      memorySize: 512,
      architecture: Architecture.ARM_64,
    });
    handler.connections.allowToDefaultPort(database);
    asyncJob.handler.grantInvoke(handler);

    const service = new CloudFrontLambdaFunctionUrlService(this, 'Resource', {
      subDomain,
      handler,
      serviceName: 'Webapp',
      hostedZone,
      certificate: props.certificate,
      accessLogBucket: props.accessLogBucket,
      signPayloadHandler: props.signPayloadHandler,
    });
    this.baseUrl = service.url;

    if (hostedZone) {
      auth.addAllowedCallbackUrls(
        `http://localhost:3010/api/auth/sign-in-callback`,
        `http://localhost:3010/api/auth/sign-out-callback`,
      );
      auth.addAllowedCallbackUrls(
        `${this.baseUrl}/api/auth/sign-in-callback`,
        `${this.baseUrl}/api/auth/sign-out-callback`,
      );
      handler.addEnvironment('AMPLIFY_APP_ORIGIN', service.url);
    } else {
      auth.updateAllowedCallbackUrls(
        [`${this.baseUrl}/api/auth/sign-in-callback`, `http://localhost:3010/api/auth/sign-in-callback`],
        [`${this.baseUrl}/api/auth/sign-out-callback`, `http://localhost:3010/api/auth/sign-out-callback`],
      );

      const originSourceParameter = new StringParameter(this, 'OriginSourceParameter', {
        stringValue: 'dummy',
      });
      originSourceParameter.grantRead(handler);
      handler.addEnvironment('AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER', originSourceParameter.parameterName);

      // We need to pass AMPLIFY_APP_ORIGIN environment variable for callback URL,
      // but we cannot know CloudFront domain before deploying Lambda function.
      // To avoid the circular dependency, we fetch the domain name on runtime.
      new AwsCustomResource(this, 'UpdateAmplifyOriginSourceParameter', {
        onUpdate: {
          service: 'ssm',
          action: 'putParameter',
          parameters: {
            Name: originSourceParameter.parameterName,
            Value: service.url,
            Overwrite: true,
          },
          physicalResourceId: PhysicalResourceId.of(originSourceParameter.parameterName),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [originSourceParameter.parameterArn],
        }),
      });
    }

    const migrationRunner = new DockerImageFunction(this, 'MigrationRunner', {
      code: DockerImageCode.fromImageAsset(join('..', 'webapp'), {
        platform: Platform.LINUX_ARM64,
        cmd: ['migration-runner.handler'],
        file: 'job.Dockerfile',
      }),
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      environment: {
        ...database.getLambdaEnvironment('main'),
      },
      vpc: database.cluster.vpc,
      memorySize: 256,
    });
    migrationRunner.connections.allowToDefaultPort(database);

    // Run database migration during CDK deployment
    // The Trigger construct automatically invokes the migration runner with default payload (command: 'deploy')
    // To manually run migrations with different commands (e.g., 'force'), use the AWS CLI command shown in the CDK output below
    const trigger = new Trigger(this, 'MigrationTrigger', {
      handler: migrationRunner,
    });
    // make sure migration is executed after the database cluster is available.
    trigger.node.addDependency(database.cluster);

    // Output migration-related information for manual invocation
    // Available commands: "deploy" (default), "force" (with --accept-data-loss)
    // Example: aws lambda invoke --function-name <FUNCTION_NAME> --payload '{"command":"force"}' --cli-binary-format raw-in-base64-out /dev/stdout
    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{"command":"deploy"}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
  }
}
