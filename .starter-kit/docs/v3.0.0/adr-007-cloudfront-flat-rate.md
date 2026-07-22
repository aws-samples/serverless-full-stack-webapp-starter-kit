# ADR-007: Compatibility with CloudFront flat-rate pricing plans

## Status

Accepted (v3.0.0)

## Context

Amazon CloudFront introduced **flat-rate pricing plans** (Free / Pro / Business / Premium) in 2025. They bundle CloudFront CDN, AWS WAF, DDoS protection, CloudWatch Logs ingestion, Route 53 DNS,
S3 storage credits, and serverless edge compute at a fixed monthly price, with no overage charges
(Source: [CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)). The **Free plan** costs $0 per month and
includes 1M requests + 100 GB of data transfer — comfortably within the kit's expected usage scale
(README.md Cost section: 100 users/month × 1000 requests/user).

To enroll in this plan, the CloudFront distribution configuration must meet the following two
constraints:

1. **Custom cache policies are prohibited**: Only AWS managed cache policies are available. Custom
   cache policies are permitted only on Business / Premium plans (Source: the "Custom caching rules"
   row in [Pricing plan features](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)
   — the Free and Pro columns are blank; only Business and Premium are marked Yes).
2. **A WAF Web ACL association is required**: The distribution must have an associated AWS WAF Web ACL
   (scope=CLOUDFRONT). This association cannot be removed unless returning to pay-as-you-go (Source:
   the passage beginning "A valid AWS WAF protection pack (web ACL) must remain associated..." in
   [Using AWS WAF with CloudFront Flat-Rate Pricing Plans](https://docs.aws.amazon.com/waf/latest/developerguide/cloudfront-features.html)).

The initial v3 kit configuration used a **custom `CachePolicy`** (the shared `SharedCachePolicy`) for
the default behavior, violating constraint 1 and preventing plan enrollment. As a side effect of that
policy's `allowList`, Next.js App Router RSC payloads (Content-Type `text/x-component`) could also
poison the normal HTML cache (Issue #176). A point fix that adds RSC-related headers to the `allowList`
(PR #183) was attempted, but although it resolves RSC cache poisoning, constraint 1 remains and it
does not enable plan enrollment.

Given the kit's purpose (a prototype / learning environment for a serverless stack) and cost target
(starting under $10/month — DESIGN_PRINCIPLES), it is highly valuable to provide enrollment in the
Free plan as the kit's default configuration.

## Decision

Wire the CloudFront distribution by default to a configuration eligible for the flat-rate plans
(Free / Pro). Because CDK does not support the enrollment operation itself, document the console
steps in the README while **removing configuration elements that prevent enrollment**.

### Use only AWS managed cache policies (`apps/cdk/lib/constructs/cf-lambda-furl-service/service.ts`)

- **default behavior → `CachePolicy.CACHING_DISABLED`** (min/max/default TTL = 0).
  CloudFront does not cache dynamic responses at all. Consequently:
  - Poisoning of the normal HTML cache by RSC payloads (Issue #176) cannot occur in principle
    — there is no cacheable response. This replaces the point fix in PR #183 that adjusts the
    `allowList` with a structural resolution.
  - Cookie / Authorization do not need to be included in the cache key (there is no cache key).
  - As before, `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` forwards all headers, cookies,
    queries, and the body to the origin. Application behavior at the origin remains unchanged.
- **`/_next/static/*` → `CachePolicy.CACHING_OPTIMIZED`**. Cache the immutable, content-hashed build
  assets emitted by Next.js at the edge instead of reaching the Lambda origin every time. Because the
  assets are public, depend only on the path, and are immutable, the managed cache policy's cache key
  (without cookies or queries) is safe. The Free plan uses 2 of its 5 cache behavior limit.

### Include a WAF Web ACL by default (`apps/cdk/lib/us-east-1-stack.ts`)

Create a minimal `CfnWebACL` in `us-east-1` (scope `CLOUDFRONT`, default action `allow`) and associate
it with the distribution. The only rule is **`AWSManagedRulesKnownBadInputsRuleSet`**. Deliberately do
not include other managed rule groups / rate-based rules (described below). Export its ARN cross-region
to the main stack, then associate it through the `webAclId?` property of
`CloudFrontLambdaFunctionUrlService`.

### Opt-out path (copy-and-edit)

Do not provide a runtime flag for downstream apps that do not need WAF. Instead, following the kit's
copy-and-grow principle, provide opt-out through a **deletion-based pattern**: remove Web ACL creation
from `us-east-1-stack.ts` and do not pass `webAclId` from `bin/cdk.ts` (`webAclId?` is optional in
`service.ts`, so removal alone works). Document this procedure in the README.

### Rationale for limiting WAF rules to `KnownBadInputs`

Keep the managed rule set minimal to avoid a starter kit experience where users receive an
"unexplained 403":

- **Exclude `AWSManagedRulesCommonRuleSet`**: `NoUserAgent_HEADER` creates false positives for health
  checks / server-side fetches, and `SizeRestrictions_Cookie` creates false positives for the large
  authentication cookies from Amplify / Cognito (known patterns based on actual measurements).
- **Exclude `AWSManagedRulesAmazonIpReputationList`**: Because it blocks based on the source IP
  reputation regardless of request content, it appears to end users as an unexplained 403.
  There is no debugging path.
- **Exclude rate-based rules**: They trigger on legitimate traffic such as shared NATs / corporate
  proxies, load tests, and Next.js prefetch bursts, causing blocks whose cause is not visible.
- **Keep `KnownBadInputs`**: It matches signatures of real attacks such as Log4Shell, so there is
  little room for false positives on legitimate traffic.

After understanding the nature of their traffic, users can decide whether to add rules within the
Free plan limit (5 rules) for their downstream apps.

### Rejected alternatives

- **Keep the custom `CachePolicy` and add RSC headers to the `allowList`** (the direction in PR #183):
  This resolves RSC cache poisoning, but constraint 1 (the custom cache policy prohibition) remains,
  so Free/Pro plan enrollment is impossible. Resolving RSC cache poisoning also carries the
  operational burden of maintaining the `allowList`.
- **Managed `USE_ORIGIN_CACHE_CONTROL_HEADERS` instead of `CACHING_DISABLED`**: This meets the
  managed cache policy constraint, but responses can be cached depending on the origin's
  `Cache-Control` headers. Because Next.js App Router returns RSC/HTML/API from a single Lambda,
  incorrect header control can cache different Content-Types at the same path. The structural
  guarantee is lost.
- **Include `CommonRuleSet` + `AmazonIpReputationList` + rate-based rules by default**: This appears
  to be a general "WAF best practice," but turns the starter kit learning experience into
  "debugging unexplained 403s." The false-positive patterns above are based on actual measurements.
  It is better for users to add them incrementally.
- **Automate plan enrollment with CDK**: CloudFront plan enrollment cannot currently be operated
  through CDK / CloudFormation. Manual operation in the console is the only path, so the README
  guides users through it.

## Consequences

- **A path to Free plan enrollment is prepared**: The single command `pnpm exec cdk deploy --all`
  provisions the distribution + Web ACL, and enrollment only requires selecting
  **Manage subscription → Free plan** in the console (see README "Enroll in the CloudFront Free plan").
- **WAF billing until enrollment**: Before enrollment, the Web ACL is billed at [standard AWS WAF pricing](https://aws.amazon.com/waf/pricing/)
  ($5/month + $1 × number of rules). Unexpected charges occur if the enrollment procedure is not
  performed immediately after deployment, so the README explicitly includes a warning and points to
  `README.md#4-enroll-in-the-cloudfront-free-plan`.
- **All dynamic requests reach the Lambda origin**: Because the default behavior is `CACHING_DISABLED`,
  authenticated requests, HTML, RSC, and APIs all reach Lambda. Lambda / Lambda@Edge costs (see the
  Cost section) are usage-based and outside the flat-rate plan. Downstream apps for which SSR/Lambda
  cost becomes a concern should consider revisiting their caching strategy (introduce custom cache
  policies on Business/Premium or switch to pay-as-you-go).
- **Static asset offloading**: `/_next/static/*` does not reach Lambda because of the edge cache.
  The Free plan's 100 GB data transfer contributes significantly here.
- **`webAclId?` and `geoRestriction?` are optional props of the `CloudFrontLambdaFunctionUrlService`
  construct**: A downstream app that wants to remove the Web ACL can return to a pay-as-you-go
  configuration simply by not passing `webAclId` from `bin/cdk.ts` (and removing the Web ACL resource
  itself). Opt-out compatibility is ensured at the construct level.
- **AWS WAF Web ACLs can only be created in `us-east-1`** (a scope=CLOUDFRONT requirement). Placing it
  in the separate `us-east-1-stack.ts` and passing its ARN to the main stack uses the same
  cross-region-reference pattern already used for Lambda@Edge and the ACM certificate.
