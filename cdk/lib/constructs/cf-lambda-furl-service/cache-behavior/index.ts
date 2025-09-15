import { CustomResource, Duration } from 'aws-cdk-lib';
import { BehaviorOptions, IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import * as cdkcf from 'aws-cdk-lib/aws-cloudfront';
import { Code, Runtime, RuntimeFamily, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { join } from 'path';
import { CacheBehaviorsConfigProps, CacheBehaviorsCustomResourceProps } from './custom-resource/type';
import * as sdkcf from '@aws-sdk/client-cloudfront';

export interface CacheBehaviorsProps {
  readonly distribution: IDistribution;
  readonly additionalBehaviors: Record<string, BehaviorOptions>;
}

export class CacheBehaviors extends Construct {
  constructor(scope: Construct, id: string, props: CacheBehaviorsProps) {
    super(scope, id);

    const { distribution } = props;

    const handler = new SingletonFunction(this, 'CustomResourceHandler', {
      // Use raw string to avoid from tightening CDK version requirement
      runtime: new Runtime('nodejs22.x', RuntimeFamily.NODEJS),
      code: Code.fromAsset(join(__dirname, 'custom-resource')),
      handler: 'index.handler',
      uuid: '28dd43e3-01cb-44c9-a71f-8e6fb18933e1', // generated for this construct
      lambdaPurpose: 'CloudFrontCacheBehaviorCustomResourceHandler',
      timeout: Duration.minutes(5),
    });

    distribution.grant(
      handler,
      //
      'cloudfront:UpdateDistribution',
      'cloudfront:GetDistributionConfig',
    );

    const translateAllowedMethods = (
      allowedMethods: cdkcf.AllowedMethods | undefined,
      cachedMethods: cdkcf.CachedMethods | undefined,
    ): sdkcf.AllowedMethods => {
      const _cachedMethods =
        cachedMethods == cdkcf.CachedMethods.CACHE_GET_HEAD
          ? [sdkcf.Method.GET, sdkcf.Method.HEAD]
          : [sdkcf.Method.GET, sdkcf.Method.OPTIONS, sdkcf.Method.HEAD];
      let _allowedMethods: sdkcf.Method[] = [];

      switch (allowedMethods) {
        case cdkcf.AllowedMethods.ALLOW_ALL:
          _allowedMethods = [
            sdkcf.Method.GET,
            sdkcf.Method.OPTIONS,
            sdkcf.Method.HEAD,
            sdkcf.Method.PUT,
            sdkcf.Method.POST,
            sdkcf.Method.DELETE,
            sdkcf.Method.PATCH,
          ];
          break;
        case cdkcf.AllowedMethods.ALLOW_GET_HEAD:
          _allowedMethods = [sdkcf.Method.GET, sdkcf.Method.HEAD];
          break;
        case cdkcf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS:
          _allowedMethods = [sdkcf.Method.GET, sdkcf.Method.HEAD, sdkcf.Method.OPTIONS];
          break;
      }
      return {
        Items: _allowedMethods,
        Quantity: _allowedMethods.length,
        CachedMethods: {
          Items: _cachedMethods,
          Quantity: _cachedMethods.length,
        },
      };
    };
    const translateLambdaFunctionAssociation = (
      edgeLambdas: cdkcf.EdgeLambda[],
    ): sdkcf.CacheBehavior['LambdaFunctionAssociations'] => {
      if (edgeLambdas.length == 0) return;
      const associations = edgeLambdas.map((edgeLambda) => {
        return {
          EventType: edgeLambda.eventType,
          LambdaFunctionARN: edgeLambda.functionVersion.functionArn,
          IncludeBody: edgeLambda.includeBody,
        };
      });
      return {
        Quantity: associations.length,
        Items: associations,
      };
    };

    const properties: CacheBehaviorsConfigProps = {
      behaviors: Object.entries(props.additionalBehaviors).map(([pathPattern, options]) => ({
        PathPattern: pathPattern,
        AllowedMethods: translateAllowedMethods(
          options.allowedMethods ?? cdkcf.AllowedMethods.ALLOW_GET_HEAD,
          options.cachedMethods ?? cdkcf.CachedMethods.CACHE_GET_HEAD,
        ),
        CachePolicyId: options.cachePolicy?.cachePolicyId,
        Compress: options.compress,
        LambdaFunctionAssociations: translateLambdaFunctionAssociation(options.edgeLambdas ?? []),
        ViewerProtocolPolicy: options.viewerProtocolPolicy,
        TargetOriginId: options.origin, // actually origin is also coupled with distribution, so we must also create a custom resource for origins...
        // DefaultTTL: options.edgeLambdas,
      })),
      distributionId: distribution.distributionId,
    };

    const custom = new CustomResource(this, 'Resource', {
      serviceToken: handler.functionArn,
      resourceType: 'Custom::CloudFrontCacheBehaviors',
      properties: {
        propsJson: JSON.stringify(properties),
      } satisfies CacheBehaviorsCustomResourceProps,
    });
  }
}
