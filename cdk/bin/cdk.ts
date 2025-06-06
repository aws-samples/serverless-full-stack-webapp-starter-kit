#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const app = new cdk.App();

interface EnvironmentProps {
  account: string;
}

const props: EnvironmentProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
};

const virginia = new UsEast1Stack(app, 'ServerlessWebappStarterKitUsEast1Stack', {
  env: {
    account: props.account,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
});
new MainStack(app, 'ServerlessWebappStarterKitStack', {
  env: {
    account: props.account,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
  sharedCertificate: virginia.certificate,
  signPayloadHandler: virginia.signPayloadHandler,
});

// import { Aspects } from 'aws-cdk-lib';
// import { AwsSolutionsChecks } from 'cdk-nag';
// Aspects.of(app).add(new AwsSolutionsChecks());
