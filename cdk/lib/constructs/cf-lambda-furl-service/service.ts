import { Construct } from 'constructs';
import { CfnOutput, CfnResource, Duration, Names, Stack } from 'aws-cdk-lib';
import { FunctionUrlAuthType, IFunction, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  CfnOriginAccessControl,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  LambdaEdgeEventType,
  OriginRequestPolicy,
  SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { EdgeFunction } from './edge-function';
import { join } from 'path';
import { readFileSync } from 'fs';

export interface CloudFrontLambdaFunctionUrlServiceProps {
  /**
   * @default use root domain
   */
  subDomain?: string;
  handler: IFunction;

  /**
   * This should be unique across the app
   */
  serviceName: string;

  /**
   * @default basic auth is disabled
   */
  basicAuthUsername?: string;
  basicAuthPassword?: string;

  hostedZone: IHostedZone;
  certificate: ICertificate;
  signPayloadHandler: EdgeFunction;
  accessLogBucket: Bucket;
}

export class CloudFrontLambdaFunctionUrlService extends Construct {
  public readonly urlParameter: StringParameter;
  public readonly url: string;

  constructor(scope: Construct, id: string, props: CloudFrontLambdaFunctionUrlServiceProps) {
    super(scope, id);
    const {
      handler,
      serviceName,
      subDomain,
      basicAuthUsername,
      basicAuthPassword,
      hostedZone,
      certificate,
      accessLogBucket,
      signPayloadHandler,
    } = props;
    const domainName = subDomain ? `${subDomain}.${hostedZone.zoneName}` : hostedZone.zoneName;

    const furl = handler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });
    const origin = new FunctionUrlOrigin(furl, {
      connectionTimeout: Duration.seconds(6),
      readTimeout: Duration.seconds(60),
    });

    const cachePolicy = new CachePolicy(this, 'SharedCachePolicy', {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        // CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS contains Host header here,
        // making it impossible to use with API Gateway
        'authorization',
        'Origin',
        'X-HTTP-Method-Override',
        'X-HTTP-Method',
        'X-Method-Override',
      ),
      defaultTtl: Duration.seconds(0),
      cookieBehavior: CacheCookieBehavior.all(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const distribution = new Distribution(this, 'Resource', {
      comment: `CloudFront for ${serviceName}`,
      defaultBehavior: {
        origin,
        cachePolicy,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      // errorResponses: [{ httpStatus: 404, responsePagePath: '/', responseHttpStatus: 200 }],
      logBucket: accessLogBucket,
      logFilePrefix: `${serviceName}/`,

      certificate: certificate,
      domainNames: [domainName],
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const oac = new CfnOriginAccessControl(this, 'LambdaOac', {
      originAccessControlConfig: {
        name: Names.uniqueResourceName(this, {}),
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const cfnDistribution = distribution.node.defaultChild as CfnResource;
    cfnDistribution.addPropertyOverride(`DistributionConfig.Origins.0.OriginAccessControlId`, oac.attrId);
    distribution.addBehavior('/*', origin, {
      cachePolicy,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      edgeLambdas: [
        {
          functionVersion: signPayloadHandler.versionArn(this),
          eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: true,
        },
      ],
      ...(basicAuthUsername && basicAuthPassword
        ? {
            functionAssociations: [
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                function: new Function(this, 'BasicAuthFunction', {
                  code: FunctionCode.fromInline(
                    readFileSync(join(__dirname, 'cff', 'basic-auth.js'))
                      .toString()
                      .replace('<BASIC>', Buffer.from(`${basicAuthUsername}:${basicAuthPassword}`).toString('base64')),
                  ),
                  runtime: FunctionRuntime.JS_2_0,
                }),
              },
            ],
          }
        : {}),
    });

    handler.addPermission('AllowCloudFrontServicePrincipal', {
      principal: new ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunctionUrl',
      sourceArn: `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`,
    });

    new ARecord(this, 'Record', {
      zone: hostedZone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      recordName: subDomain,
    });

    this.url = `https://${domainName}`;
    new CfnOutput(this, 'CloudFrontUrl', { value: this.url });
  }
}
