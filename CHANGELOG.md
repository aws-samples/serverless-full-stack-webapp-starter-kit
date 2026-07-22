# Changelog

## [2.1.0](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/compare/v2.0.0...v2.1.0) (2026-03-22)


### Features

* add /update-snapshot comment trigger to update_snapshot workflow ([764a4fa](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/764a4fa0808b7fb11307f393208449588daa8b3c))
* add CloudWatch LogGroup with retention policy to Lambda functions ([#117](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/117)) ([53877bb](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/53877bb31b5af7cfbb5e80903be076e8ce1c38d6)), closes [#103](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/103)
* **database:** enable Data API and connection logging ([#123](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/123)) ([e32dc7a](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/e32dc7ad5ceb0c36fd287c18e64177e92f0c5ff0))
* increase webapp Lambda memory from 512MB to 1024MB ([#116](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/116)) ([03c5a00](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/03c5a007e141c25b9631a3b38680f62dfe22320f)), closes [#101](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/101)


### Bug Fixes

* add lambda:InvokeFunction permission for CloudFront OAC ([#83](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/83)) ([3cc66bf](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/3cc66bfb775f3a086f231783955b258136ddd266))
* **auth:** improve auth error handling and fix Link CORS issue ([#120](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/120)) ([84be605](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/84be6057d7416c7dd34a7eec3422144bce2f964c))
* disable Cognito self sign-up by default ([#115](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/115)) ([9396e6f](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/9396e6fbefe2feadb5e2eea4ccc03aa2a1c0888e)), closes [#106](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/106)
* prevent CloudFront cache poisoning for Next.js RSC responses ([#119](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/119)) ([70cddda](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/70cddda904ee816a763c53a7a36ce1ea183ff941))
* **prisma:** add retry for Aurora Serverless v2 connection errors ([#121](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/121)) ([7c05dfb](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/7c05dfb61949caf8b8f79a56ec7c2c1e88a04839))
* support Amazon Linux 2023 for NAT instance ([#81](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/81)) ([0c41aa8](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/0c41aa8ec1946883f397126c8e6ae91c0e96b1b0))

## 2.0.0 (2026-03-18)


### Features

* invalidate cloudfront caches when lambda configuration changes ([#63](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/63)) ([b76d122](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/b76d1223d1e00a6b77ee5f89b4d7f9678b01232a))


### Bug Fixes

* pass useNatInstance prop to MainStack ([#71](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/71)) ([23c9e31](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/23c9e31a73d44254cf45d84015bc6cd9c045880b))
* Workflow does not contain permissions ([#59](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/59)) ([34be1de](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/34be1deaf7e02320e097861b989e1e046bfa8488))
* Workflow does not contain permissions ([#60](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/issues/60)) ([6fb8901](https://github.com/aws-samples/serverless-full-stack-webapp-starter-kit/commit/6fb89018d26428c069679a1443e2010cb4bb4fc5))
