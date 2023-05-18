#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ServerlessFullstackWebappStarterKitStack } from '../lib/serverless-fullstack-webapp-starter-kit-stack';
import { CfnGuardValidator } from '@cdklabs/cdk-validator-cfnguard';

const app = new cdk.App({
  policyValidationBeta1: [new CfnGuardValidator()],
});
new ServerlessFullstackWebappStarterKitStack(app, 'ServerlessFullstackWebappStarterKitStack', {});

// import { Aspects } from 'aws-cdk-lib';
// import { AwsSolutionsChecks } from 'cdk-nag';
// Aspects.of(app).add(new AwsSolutionsChecks());
