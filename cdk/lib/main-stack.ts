import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Auth } from './constructs/auth/';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Webapp } from './constructs/webapp';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';

interface MainStackProps extends StackProps {
  readonly signPayloadHandler: EdgeFunction;

  readonly domainName?: string;
  readonly sharedCertificate?: ICertificate;

  /**
   * @default true
   */
  readonly useNatInstance?: boolean;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, { description: 'repro', ...props });

    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    const auth = new Auth(this, 'Auth', {
      sharedCertificate: props.sharedCertificate,
    });

    const webapp = new Webapp(this, 'Webapp', {
      certificate: props.sharedCertificate,
      signPayloadHandler: props.signPayloadHandler,
      accessLogBucket,
      auth,
    });

    new CfnOutput(this, 'FrontendDomainName', {
      value: webapp.baseUrl,
    });
  }
}
