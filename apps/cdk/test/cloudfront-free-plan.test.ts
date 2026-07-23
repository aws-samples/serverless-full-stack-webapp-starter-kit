import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

// Managed CachePolicy.CACHING_DISABLED id (min/max/default TTL = 0). Flat-rate Free/Pro plans
// forbid custom cache policies, so the default behavior must reference this managed policy.
const CACHING_DISABLED_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

// Managed CachePolicy.CACHING_OPTIMIZED id. Used for immutable /_next/static assets so they are
// edge-cached instead of hitting the Lambda origin on every request.
const CACHING_OPTIMIZED_ID = '658327ea-f89d-4fab-a63d-7e88639e58f6';

const account = '123456789012';

function getDistributionConfig(template: Template) {
  const distributions = template.findResources('AWS::CloudFront::Distribution');
  return Object.values(distributions)[0].Properties.DistributionConfig as Record<string, unknown>;
}

// Mirrors bin/cdk.ts: the us-east-1 stack always provisions the CLOUDFRONT Web ACL, and its ARN
// is passed to the main stack so the distribution is enrolled in the flat-rate pricing plan.
function synth() {
  const app = new cdk.App();
  const virginia = new UsEast1Stack(app, 'UsEast1Stack', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const mainStack = new MainStack(app, 'MainStack', {
    env: { account, region: 'us-west-2' },
    crossRegionReferences: true,
    signPayloadHandler: virginia.signPayloadHandler,
    webAclId: virginia.webAclArn,
  });
  return { virginia: Template.fromStack(virginia), main: Template.fromStack(mainStack) };
}

describe('CloudFront flat-rate plan compatibility (issue #187)', () => {
  test('default behavior uses the managed CACHING_DISABLED policy, not a custom CachePolicy resource', () => {
    const { main } = synth();
    // No custom cache policy resource exists (custom policies block Free/Pro enrollment).
    main.resourceCountIs('AWS::CloudFront::CachePolicy', 0);
    const defaultBehavior = getDistributionConfig(main).DefaultCacheBehavior as Record<string, unknown>;
    expect(defaultBehavior.CachePolicyId).toBe(CACHING_DISABLED_ID);
  });

  test('immutable /_next/static assets are edge-cached via a managed CACHING_OPTIMIZED behavior', () => {
    const { main } = synth();
    const behaviors = getDistributionConfig(main).CacheBehaviors as Array<Record<string, unknown>>;
    const staticBehavior = behaviors.find((b) => b.PathPattern === '/_next/static/*');
    expect(staticBehavior).toBeDefined();
    expect(staticBehavior?.CachePolicyId).toBe(CACHING_OPTIMIZED_ID);
  });

  test('stays within the flat-rate Free plan limit of 5 cache behaviors', () => {
    const { main } = synth();
    const additional = (getDistributionConfig(main).CacheBehaviors as unknown[] | undefined)?.length ?? 0;
    // default behavior (1) + additional behaviors.
    expect(1 + additional).toBeLessThanOrEqual(5);
  });

  test('the distribution is associated with the Web ACL', () => {
    const { main } = synth();
    expect(getDistributionConfig(main).WebACLId).toBeDefined();
  });
});

describe('us-east-1 WAF Web ACL for the flat-rate plan (issue #187)', () => {
  test('is a Free-plan-compliant CLOUDFRONT-scoped Web ACL without false-positive-prone rules', () => {
    const { virginia } = synth();

    virginia.resourceCountIs('AWS::WAFv2::WebACL', 1);
    virginia.hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'CLOUDFRONT' });

    const webAcls = virginia.findResources('AWS::WAFv2::WebACL');
    const rules = Object.values(webAcls)[0].Properties.Rules as Array<Record<string, unknown>>;
    // Free plan allows at most 5 rules.
    expect(rules.length).toBeLessThanOrEqual(5);

    const serialized = JSON.stringify(rules);
    // No rules that cause hard-to-diagnose false positives:
    expect(serialized).not.toContain('rateBasedStatement'); // rate limiting
    expect(serialized).not.toContain('AmazonIpReputationList'); // IP-reputation blocking
    expect(serialized).not.toContain('AnonymousIpList'); // blocks Free-plan subscription
    expect(serialized).not.toContain('CommonRuleSet'); // cookie-size / no-user-agent false positives
  });
});
