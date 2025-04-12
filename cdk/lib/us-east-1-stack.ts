import * as cdk from 'aws-cdk-lib';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
import { join } from 'path';

interface UsEast1StackProps extends cdk.StackProps {
  domainName: string;
}

export class UsEast1Stack extends cdk.Stack {
  public readonly certificate: ICertificate;
  public readonly signPayloadHandler: EdgeFunction;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.domainName,
    });

    // cognito requires A record for Hosted UI custom domain
    // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html#cognito-user-pools-add-custom-domain-adding
    // > Its parent domain must have a valid DNS A record. You can assign any value to this record.
    new ARecord(this, 'Record', {
      zone: hostedZone,
      target: RecordTarget.fromIpAddresses('8.8.8.8'),
    });

    const cert = new Certificate(this, 'CertificateV2', {
      domainName: `*.${hostedZone.zoneName}`,
      validation: CertificateValidation.fromDns(hostedZone),
      subjectAlternativeNames: [hostedZone.zoneName],
    });

    const signPayloadHandler = new EdgeFunction(this, 'SignPayloadHandler', {
      entryPath: join(__dirname, 'constructs', 'cf-lambda-furl-service', 'lambda', 'sign-payload.ts'),
    });

    this.certificate = cert;
    this.signPayloadHandler = signPayloadHandler;
  }
}
