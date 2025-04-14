import { IgnoreMode, Duration, CfnOutput, Stack } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageFunction, DockerImageCode, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { CloudFrontLambdaFunctionUrlService } from './cf-lambda-furl-service/service';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Database } from './database';
import { EdgeFunction } from './cf-lambda-furl-service/edge-function';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Auth } from './auth';
import { ContainerImageBuild } from 'deploy-time-build';
import { join } from 'path';
import { Trigger } from 'aws-cdk-lib/triggers';

export interface WebappProps {
  database: Database;
  hostedZone: IHostedZone;
  certificate: ICertificate;
  signPayloadHandler: EdgeFunction;
  accessLogBucket: Bucket;
  auth: Auth;
  /**
   * Use root domain
   */
  subDomain?: string;
}

export class Webapp extends Construct {
  public readonly baseUrl: string;

  constructor(scope: Construct, id: string, props: WebappProps) {
    super(scope, id);

    const { database, hostedZone, auth, subDomain } = props;

    // Use ContainerImageBuild to inject deploy-time values in the build environment
    const image = new ContainerImageBuild(this, 'Build', {
      directory: join('..', 'webapp'),
      platform: Platform.LINUX_ARM64,
      ignoreMode: IgnoreMode.DOCKER,
      exclude: readFileSync(join('..', 'webapp', '.dockerignore')).toString().split('\n'),
      tagPrefix: 'webapp-starter-',
      buildArgs: {
        HOST_DOMAIN: `${subDomain}.${hostedZone.zoneName}`,
        SKIP_TS_BUILD: 'true',
        AMPLIFY_APP_ORIGIN: `https://${subDomain}.${hostedZone.zoneName}`,
        COGNITO_DOMAIN: auth.domainName,
        USER_POOL_ID: auth.userPool.userPoolId,
        USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
      },
    });

    const handler = new DockerImageFunction(this, 'Handler', {
      code: image.toLambdaDockerImageCode(),
      timeout: Duration.minutes(3),
      environment: {
        ...database.getLambdaEnvironment('main'),
        AMPLIFY_APP_ORIGIN: `https://${subDomain}.${hostedZone.zoneName}`,
        HOST_DOMAIN: `${subDomain}.${hostedZone.zoneName}`,
        COGNITO_DOMAIN: auth.domainName,
        USER_POOL_ID: auth.userPool.userPoolId,
        USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
      },
      vpc: database.cluster.vpc,
      memorySize: 512,
      architecture: Architecture.ARM_64,
    });
    handler.connections.allowToDefaultPort(database);

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

    auth.addAllowedCallbackUrls(
      `http://localhost:3010/api/auth/sign-in-callback`,
      `http://localhost:3010/api/auth/sign-out-callback`,
    );
    auth.addAllowedCallbackUrls(
      `${this.baseUrl}/api/auth/sign-in-callback`,
      `${this.baseUrl}/api/auth/sign-out-callback`,
    );

    const migrationRunner = new DockerImageFunction(this, 'MigrationRunner', {
      code: DockerImageCode.fromImageAsset(join('..', 'webapp'), {
        platform: Platform.LINUX_ARM64,
        cmd: ['migration-runner.handler'],
        file: 'jobs.Dockerfile',
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

    // run database migration during CDK deployment
    const trigger = new Trigger(this, 'MigrationTrigger', {
      handler: migrationRunner,
    });
    // make sure migration is executed after the database cluster is available.
    trigger.node.addDependency(database.cluster);

    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{"command":"deploy"}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
  }
}
