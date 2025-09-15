import { CacheBehavior } from '@aws-sdk/client-cloudfront';

export interface CacheBehaviorsConfigProps {
  behaviors: CacheBehavior[];
  distributionId: string;
}

export interface CacheBehaviorsCustomResourceProps {
  propsJson: string;
}
