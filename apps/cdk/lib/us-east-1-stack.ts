import * as cdk from 'aws-cdk-lib';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
import { join } from 'path';

interface UsEast1StackProps extends cdk.StackProps {
  /**
   * Custom domain name for the webapp and Cognito.
   *
   * @default No custom domain. CloudFront and Cognito will use their default domains.
   */
  domainName?: string;
}

export class UsEast1Stack extends cdk.Stack {
  /**
   * the ACM certificate for CloudFront (it must be deployed in us-east-1).
   * undefined if domainName is not set.
   */
  public readonly certificate: ICertificate | undefined = undefined;
  /**
   * the signer L@E function (it must be deployed in us-east-1).
   */
  public readonly signPayloadHandler: EdgeFunction;
  /**
   * ARN of the WAF Web ACL (scope=CLOUDFRONT) associated with the CloudFront distribution.
   * Required for the CloudFront flat-rate pricing plan.
   */
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    if (props.domainName) {
      const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.domainName,
      });

      // cognito requires A record for Hosted UI custom domain
      // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html#cognito-user-pools-add-custom-domain-adding
      // > Its parent domain must have a valid DNS A record. You can assign any value to this record.
      new ARecord(this, 'Record', {
        zone: hostedZone,
        // Cognito custom domain requires the parent zone to have a valid A record — the
        // value itself is not resolved during OAuth. Use TEST-NET-1 (RFC 5737), the
        // documentation range for sample values, so this record cannot accidentally
        // point real traffic at any live host.
        // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-add-custom-domain.html#cognito-user-pools-add-custom-domain-adding
        target: RecordTarget.fromIpAddresses('192.0.2.1'),
      });

      const cert = new Certificate(this, 'CertificateV2', {
        domainName: `*.${hostedZone.zoneName}`,
        validation: CertificateValidation.fromDns(hostedZone),
        subjectAlternativeNames: [hostedZone.zoneName],
      });
      this.certificate = cert;
    }

    const signPayloadHandler = new EdgeFunction(this, 'SignPayloadHandler', {
      entryPath: join(__dirname, 'constructs', 'cf-lambda-furl-service', 'lambda', 'sign-payload.ts'),
    });

    this.signPayloadHandler = signPayloadHandler;

    // WAF Web ACL associated with the CloudFront distribution. Required for the CloudFront
    // flat-rate pricing plan (an associated Web ACL is mandatory to enroll).
    //
    // Intentionally minimal to avoid hard-to-diagnose false positives in a starter kit:
    //   - No rate-based rule: trips on shared NAT / corporate proxies, load tests, and Next.js
    //     prefetch bursts, blocking legitimate users with an opaque 403.
    //   - No AmazonIpReputationList: blocks specific users by source-IP reputation with no
    //     request-content cause — impossible for the user to understand.
    //   - No CommonRuleSet: its NoUserAgent_HEADER and SizeRestrictions_Cookie rules false-positive
    //     on health checks / server-side fetches and on large Amplify/Cognito auth cookies.
    // Only KnownBadInputs is kept: it matches actual exploit signatures (e.g. Log4Shell) that do
    // not appear in legitimate traffic, so it blocks nothing a real user would send. Add more
    // managed rule groups (up to the Free plan's 5-rule limit) once you understand your traffic.
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'WebappWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedKnownBadInputs',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputs',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    this.webAclArn = webAcl.attrArn;
  }
}
