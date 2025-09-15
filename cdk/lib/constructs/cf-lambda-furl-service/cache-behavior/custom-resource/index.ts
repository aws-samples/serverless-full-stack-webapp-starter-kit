import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceHandler,
  CloudFormationCustomResourceResourcePropertiesCommon,
  Context,
} from 'aws-lambda';
import { CacheBehaviorsCustomResourceProps, CacheBehaviorsConfigProps } from './type';
import {
  CacheBehavior,
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront';

const client = new CloudFrontClient({});

export const handler: CloudFormationCustomResourceHandler<
  CacheBehaviorsCustomResourceProps & CloudFormationCustomResourceResourcePropertiesCommon
> = async (event, context) => {
  try {
    let oldProps: CacheBehaviorsConfigProps | undefined = undefined;
    const props = JSON.parse(event.ResourceProperties.propsJson) as CacheBehaviorsConfigProps;
    const distributionId = props.distributionId;

    switch (event.RequestType) {
      case 'Update':
        oldProps = JSON.parse(event.ResourceProperties.propsJson) as CacheBehaviorsConfigProps;
      case 'Create':
        {
          if (oldProps?.distributionId != distributionId) {
            // the old resource will be removed by CustomResource Delete handler (we change the physicalId for that.)
            oldProps = undefined;
          }
          await updateBehaviors(distributionId, props.behaviors, oldProps?.behaviors ?? []);
        }
        break;
      case 'Delete':
        {
          await updateBehaviors(distributionId, [], []);
        }
        break;
    }

    await sendStatus('SUCCESS', event, context, distributionId);
  } catch (e) {
    console.log(e);
    const err = e as Error;
    await sendStatus('FAILED', event, context, '', err.message);
  }
};

const updateBehaviors = async (
  distributionId: string,
  newBehaviors: CacheBehavior[],
  oldBehaviors: CacheBehavior[],
) => {
  const distributionConfig = await client.send(new GetDistributionConfigCommand({ Id: distributionId }));
  if (!distributionConfig.DistributionConfig) {
    throw new Error('Distribution not found: ' + distributionId);
  }
  const currentBehaviors = distributionConfig.DistributionConfig.CacheBehaviors?.Items ?? [];

  // add/update behaviors that are in props
  // remove behaviors that are in oldProps but not in props
  // sort behavior order with the following logic:
  //  1. behaviors not in props -> keep the order as-is
  //  2. behaviors in props -> Keep the input order.

  const removedBehaviors = (oldBehaviors ?? []).filter(
    (b) => !newBehaviors.some((b2) => b2.PathPattern == b.PathPattern),
  );
  const keptBehaviors = currentBehaviors.filter(
    (b) => !removedBehaviors.some((removed) => removed.PathPattern == b.PathPattern),
  );
  const uncontrolledBehaviors = keptBehaviors.filter(
    (b) => !newBehaviors.some((b2) => b2.PathPattern == b.PathPattern),
  );
  const updatedBehaviors = [...uncontrolledBehaviors, ...newBehaviors];
  distributionConfig.DistributionConfig.CacheBehaviors = {
    Quantity: updatedBehaviors.length,
    Items: updatedBehaviors,
  };

  await client.send(
    new UpdateDistributionCommand({
      DistributionConfig: distributionConfig.DistributionConfig,
      Id: distributionId,
      IfMatch: distributionConfig.ETag,
    }),
  );
};

const sendStatus = async (
  status: 'SUCCESS' | 'FAILED',
  event: CloudFormationCustomResourceEvent,
  context: Context,
  physicalResourceId: string,
  reason?: string,
) => {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason ?? 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: {}, //responseData
  });

  await fetch(event.ResponseURL, {
    method: 'PUT',
    body: responseBody,
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length.toString(),
    },
  });
};
