import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { Auth } from './constructs/auth';
import { CronJobs } from './constructs/cron-jobs';
import { Database } from './constructs/database';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Webapp } from './constructs/webapp';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
import { EventBus } from './constructs/event-bus/';

interface MainStackProps extends StackProps {
  readonly sharedCertificate: ICertificate;
  readonly signPayloadHandler: EdgeFunction;
  readonly domainName: string;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, { description: 'Serverless fullstack webapp stack (uksb-1tupboc47)', ...props });

    const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.domainName,
    });

    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    const vpc = new Vpc(this, `Vpc`, {
      natGateways: 1,
    });

    const database = new Database(this, 'Database', { vpc });

    const auth = new Auth(this, 'Auth', {
      hostedZone,
      sharedCertificate: props.sharedCertificate,
    });

    const eventBus = new EventBus(this, 'EventBus', {});
    eventBus.addUserPoolProvider(auth.userPool);

    const webapp = new Webapp(this, 'Webapp', {
      database,
      hostedZone,
      certificate: props.sharedCertificate,
      signPayloadHandler: props.signPayloadHandler,
      accessLogBucket,
      auth,
      eventBus,
      subDomain: 'web',
    });
    // const asyncJob = new AsyncJob(this, 'AsyncJob', { database: database.table });
    // const cronJobs = new CronJobs(this, 'CronJobs', { database: database.table, jobQueue: asyncJob.queue });

    new CfnOutput(this, 'FrontendDomainName', {
      value: webapp.baseUrl,
    });
  }
}
