import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { Auth } from './constructs/auth';
import { BackendApi } from './constructs/backend-api';
import { CronJobs } from './constructs/cron-jobs';
import { Database } from './constructs/database';
import { Frontend } from './constructs/frontend';

export class ServerlessFullstackWebappStarterKitStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { description: 'Serverless fullstack webapp stack (uksb-1tupboc47)', ...props });

    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    const auth = new Auth(this, 'Auth');
    const database = new Database(this, 'Database');
    const asyncJob = new AsyncJob(this, 'AsyncJob', { database: database.table });
    const cronJobs = new CronJobs(this, 'CronJobs', { database: database.table, jobQueue: asyncJob.queue });
    const backend = new BackendApi(this, 'BackendApi', {
      database: database.table,
      auth,
      jobQueue: asyncJob.queue,
    });
    const frontend = new Frontend(this, 'Frontend', {
      backendApi: backend.api,
      auth,
      accessLogBucket,
    });

    new CfnOutput(this, 'FrontendDomainName', {
      value: `https://${frontend.cloudFrontWebDistribution.distributionDomainName}`,
    });
  }
}
