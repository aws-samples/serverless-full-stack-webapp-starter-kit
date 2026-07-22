# ADR-006: Deploy-Time Image Builds with `ContainerImageBuild`

## Status

Accepted (v3.0.0)

## Context

The kit builds three Docker images (`webapp`, `async-job`, and `dsql-migrator`) for Lambda.
The standard option is CDK's built-in `DockerImageCode.fromImageAsset` — it builds the image with the local Docker CLI at synth time and pushes it to ECR — but this introduces the following issues:

1. **Local Docker becomes mandatory**: Developer machines and CI runners require Docker Desktop / a Docker daemon.
   Docker Desktop setup on Windows is complex (WSL2 configuration and license review), and CI requires a Docker-in-Docker configuration.
   This conflicts with the design policy that the kit's Prerequisites should consist only of Node.js + pnpm + AWS CLI (README, "Getting started").
2. **Architecture mismatch**: Even when developer machines are x86_64 (Intel Macs or Windows), the Lambda execution platform is
   ARM64. `fromImageAsset` is tied to the local Docker architecture, requiring a `--platform`
   setting and emulation (QEMU), which harms build time and reliability.

Meanwhile, `webapp` must inject `NEXT_PUBLIC_*` build-time env values from CDK context as
`buildArgs` (the Amplify SDK requires static values at build time rather than runtime — see the
[design doc](design.md#lambda-environment) for details). This one location requires a mechanism
that passes values determined at synth time as build arguments. Although the standard `fromImageAsset` accepts
`buildArgs`, it also has the issues in 1 and 2 above.

## Decision

Build all three images with the **`ContainerImageBuild` construct from the `@cdklabs/deploy-time-build` package**.
Do not use `DockerImageCode.fromImageAsset`.

- Implementation: In `apps/cdk/lib/constructs/{webapp,async-job,dsql-migrator/index}.ts`, create
  `new ContainerImageBuild(this, 'Build', { directory: <repo-root>, platform: Platform.LINUX_ARM64,
file: 'apps/*/Dockerfile', ignoreMode: IgnoreMode.DOCKER })`, then pass
  `image.toLambdaDockerImageCode()` to `DockerImageFunction`.
- Mechanism: When `cdk deploy` runs, a CloudFormation Custom Resource starts a CodeBuild project
  (ARM64, `general1.small`) on AWS. It builds the image and pushes it to ECR.
  Multiple `ContainerImageBuild` instances with the same stack and architecture share one CodeBuild project
  through the construct's internal `SingletonProject`.
- `webapp` `buildArgs` (`ALLOWED_ORIGIN_HOST`, `NEXT_PUBLIC_EVENT_HTTP_ENDPOINT`,
  `NEXT_PUBLIC_AWS_REGION`, and others) continue to be embedded at synth time and are passed to
  the CodeBuild-side build.
- Also migrate from the predecessor `deploy-time-build` package to its official successor,
  `@cdklabs/deploy-time-build` (under the cdklabs scope).

### Rejected alternatives

- **`DockerImageCode.fromImageAsset` (retain)**: The Context issues above (Docker requirement and
  cross-architecture emulation) remain. In particular, it hinders the first-deployment experience
  on Windows.
- **Pre-build in CI (such as GitHub Actions), push to ECR, and have CDK reference an existing image**:
  This harms the kit's reproducibility goal (Reproducibility in DESIGN_PRINCIPLES) that deployment
  completes with the single command `pnpm exec cdk deploy --all`. The deployment procedure becomes a
  two-step process, "push → deploy", and pre-build becomes a manual operational burden for downstream apps
  without CI in place.
- **Define a CodeBuild project in handwritten CDK code**: This would reimplement the project sharing
  provided by `SingletonProject` in `deploy-time-build`, the wiring to a CloudFormation Custom Resource,
  and ECR repository management, which exceeds the kit's scope.

## Consequences

- **Docker is removed from Prerequisites**: README Prerequisites are now only Node.js, pnpm, and AWS CLI.
  Windows developers can deploy without setting up WSL2 + Docker Desktop.
- **Docker layer caching is unavailable (trade-off)**: `ContainerImageBuild` updates the Custom Resource when
  the input Asset (the build context after `.dockerignore` is applied), `buildArgs`, or other inputs change,
  and CodeBuild performs a **full build from a clean environment**.
  Compared with local Docker builds, it loses incremental build acceleration from reusing layers for
  `node_modules` installation and `next build` (the model is that all layers rebuild every time, even when
  only one line of code changes). One full build takes several minutes to around 10 minutes per image.
  This is noticeable during iterative development.
- **Deployments without input changes do not rebuild**: `ContainerImageBuild` embeds the input Asset
  content hash in the Custom Resource properties, so a `cdk deploy` in which none of the source, Dockerfile,
  or `buildArgs` have changed makes the Custom Resource a No-Op and does not start CodeBuild. There is no
  situation where CodeBuild for an untouched stack runs every time and increases costs.
- **CodeBuild concurrent execution quota**: The concurrent execution quota for ARM/Small defaults to 1
  (for the entire AWS account). The three images in the same stack share one project through `SingletonProject`,
  so they run sequentially. If another stack or project uses ARM/Small CodeBuild concurrently, it is queued.
  If this becomes a frequent issue, the quota can be increased through Service Quotas (via AWS Support).
- **Required IAM permissions**: `ContainerImageBuild` configures multiple permission principals together:
  (a) the CDK/CloudFormation execution role (equivalent to `cdk-*-cfn-exec-role-*`) must be able to **create**
  the CodeBuild project, ECR repository, Custom Resource Lambda, and its execution role;
  (b) the Custom Resource Handler Lambda automatically generated by the construct must receive the
  `codebuild:StartBuild` permission (configured by `ContainerImageBuild`);
  (c) the service role of the CodeBuild project automatically generated by the construct must receive ECR
  pull/push permissions (configured by the construct through `repository.grantPullPush(project)`).
  The role created by standard `cdk bootstrap` has the permissions in (a). However, downstream apps that use
  a custom bootstrap with restricted permissions must explicitly add permissions to create these resources.
  Because (b) and (c) are auto-wired by the construct, kit users need to consider only (a).
- **CodeBuild execution cost**: Usage charges for `general1.small` are added (a small per-build charge; see
  [AWS CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/) for current rates). This can become
  non-negligible during iterative deployment in development, but as described above, CodeBuild does not start
  for deployments without input changes, so the impact in normal operation is small.
- **The `dsql-migrator` requires an explicit content hash for change detection**: Because the image content hash of
  `ContainerImageBuild` is not determined at CDK synth time, standard CDK/CloudFormation change detection
  cannot detect changes to `migrations/`. The migrator Construct calculates a content hash of the entire
  `migrations/` directory and fills this gap by:
  (1) invalidating the Lambda published version with `Function.invalidateVersionBasedOn(hash)`, and
  (2) injecting it as `MigrationHash` into the CDK Trigger's `Custom::Trigger` property
  (implementation: `apps/cdk/lib/constructs/dsql-migrator/index.ts`).
  For details of this handling and the design decision (why it selects a whole-directory hash rather than
  sharing an extension list), see [ADR-001](adr-001-dsql-drizzle-migrator.md).
