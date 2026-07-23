import { Construct } from 'constructs';
import { Aws, Duration } from 'aws-cdk-lib';
import { FunctionUrlAuthType, Function, InvokeMode, CfnPermission } from 'aws-cdk-lib/aws-lambda';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  GeoRestriction,
  LambdaEdgeEventType,
  OriginRequestPolicy,
  SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { EdgeFunction } from './edge-function';
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';

export interface CloudFrontLambdaFunctionUrlServiceProps {
  /**
   * Subdomain name for the service. If not specified, the root domain will be used.
   *
   * @default use root domain
   */
  subDomain?: string;
  handler: Function;

  /**
   * This should be unique across the app
   */
  serviceName: string;

  /**
   * @default basic auth is disabled
   */
  basicAuthUsername?: string;
  basicAuthPassword?: string;

  /**
   * Route 53 hosted zone for custom domain.
   *
   * @default No custom domain. CloudFront's default domain will be used.
   */
  hostedZone?: IHostedZone;
  /**
   * ACM certificate for custom domain (must be in us-east-1 for CloudFront).
   *
   * @default No custom domain.
   */
  certificate?: ICertificate;
  signPayloadHandler: EdgeFunction;
  accessLogBucket: Bucket;

  /**
   * ARN of a WAF Web ACL (scope=CLOUDFRONT, must be created in us-east-1) to associate
   * with the distribution.
   *
   * Required to enroll the distribution in a CloudFront flat-rate pricing plan
   * (Free/Pro/Business/Premium), which mandates an associated Web ACL. Leave unset for
   * the default pay-as-you-go setup (no Web ACL is associated).
   *
   * @default No Web ACL is associated (pay-as-you-go).
   */
  webAclId?: string;

  /**
   * Geographic restriction for the distribution (e.g. `GeoRestriction.allowlist('JP')`).
   *
   * @default No geographic restriction.
   */
  geoRestriction?: GeoRestriction;
}

export class CloudFrontLambdaFunctionUrlService extends Construct {
  public readonly urlParameter: StringParameter;
  public readonly url: string;
  public readonly domainName: string;

  constructor(scope: Construct, id: string, props: CloudFrontLambdaFunctionUrlServiceProps) {
    super(scope, id);
    const {
      handler,
      serviceName,
      subDomain,
      hostedZone,
      certificate,
      accessLogBucket,
      signPayloadHandler,
      webAclId,
      geoRestriction,
    } = props;
    let domainName = '';
    if (hostedZone) {
      domainName = subDomain ? `${subDomain}.${hostedZone.zoneName}` : hostedZone.zoneName;
    }

    const furl = handler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });
    const origin = FunctionUrlOrigin.withOriginAccessControl(furl, {
      connectionTimeout: Duration.seconds(6),
      readTimeout: Duration.seconds(60),
    });

    // CloudFront flat-rate pricing plan (Free/Pro) compatibility: custom cache policies are
    // only available on Business/Premium, so we use AWS managed cache policies only.
    //
    // Default behavior uses CachePolicy.CACHING_DISABLED (min/max/default TTL = 0):
    //   - CloudFront never caches dynamic responses, so there is no cross-user cache pollution
    //     risk; Cookie/Authorization need not be part of the cache key. This also structurally
    //     resolves the Next.js App Router RSC payload cache pollution issue (nothing to pollute).
    //   - Requests (headers/cookies/query string/body) are still forwarded to the origin via
    //     OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER, so request handling is unchanged.
    //   - App-level compression (gzip/brotli) is handled at the origin by Lambda Web Adapter +
    //     Next.js, so CloudFront's automatic compression on this behavior is unnecessary.
    //
    // /_next/static/* uses CachePolicy.CACHING_OPTIMIZED so immutable, content-hashed build
    // assets are cached at the edge instead of hitting the Lambda origin on every request. These
    // assets are public and vary only by path, so the managed policy's cache key (no cookies, no
    // query strings) is safe; Next.js serves them with `Cache-Control: public, max-age=31536000,
    // immutable`. The origin-request signer runs only on cache misses. This is a second cache
    // behavior (flat-rate Free allows up to 5).
    const edgeLambdas = [
      {
        functionVersion: signPayloadHandler.versionArn(this),
        eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
        includeBody: true,
      },
    ];

    const distribution = new Distribution(this, 'Resource', {
      comment: `CloudFront for ${serviceName}`,
      defaultBehavior: {
        origin,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        edgeLambdas,
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          edgeLambdas,
        },
      },
      // errorResponses: [{ httpStatus: 404, responsePagePath: '/', responseHttpStatus: 200 }],
      logBucket: accessLogBucket,
      logFilePrefix: `${serviceName}/`,

      ...(hostedZone ? { certificate: certificate, domainNames: [domainName] } : {}),

      // Associate a WAF Web ACL / geo restriction only when provided (required for flat-rate plans).
      ...(webAclId ? { webAclId } : {}),
      ...(geoRestriction ? { geoRestriction } : {}),

      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Starting October 2025, new function URLs require both lambda:InvokeFunctionUrl
    // and lambda:InvokeFunction permissions for CloudFront OAC.
    // CDK's FunctionUrlOrigin.withOriginAccessControl only adds lambda:InvokeFunctionUrl,
    // so we explicitly add lambda:InvokeFunction here.
    // See: https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html
    new CfnPermission(this, 'InvokeFunctionPermission', {
      action: 'lambda:InvokeFunction',
      functionName: handler.functionArn,
      principal: 'cloudfront.amazonaws.com',
      sourceArn: `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/${distribution.distributionId}`,
    });

    if (hostedZone) {
      new ARecord(this, 'Record', {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        recordName: subDomain,
      });
    } else {
      domainName = distribution.domainName;
    }

    // Invalidate CloudFront when Lambda function version changes
    new AwsCustomResource(this, 'CloudFrontInvalidation', {
      onUpdate: {
        service: 'cloudfront',
        action: 'createInvalidation',
        parameters: {
          DistributionId: distribution.distributionId,
          InvalidationBatch: {
            CallerReference: handler.currentVersion.version,
            Paths: {
              Quantity: 1,
              Items: ['/*'],
            },
          },
        },
        physicalResourceId: PhysicalResourceId.of('invalidation'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [distribution.distributionArn],
      }),
    });

    this.url = `https://${domainName}`;
    this.domainName = domainName;
  }
}
