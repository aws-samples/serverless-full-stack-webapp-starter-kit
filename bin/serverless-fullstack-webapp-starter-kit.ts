#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ServerlessFullstackWebappStarterKitStack } from '../lib/serverless-fullstack-webapp-starter-kit-stack';

const app = new cdk.App();
new ServerlessFullstackWebappStarterKitStack(app, 'ServerlessFullstackWebappStarterKitStack', {});

// import { Aspects } from 'aws-cdk-lib';
// import { AwsSolutionsChecks } from 'cdk-nag';
// Aspects.of(app).add(new AwsSolutionsChecks());
