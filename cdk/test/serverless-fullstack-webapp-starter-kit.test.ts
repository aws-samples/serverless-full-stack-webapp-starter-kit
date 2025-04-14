import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

test('Snapshot test', () => {
  const app = new cdk.App();
  const props = {
    account: '123456789012',
    domainName: 'example.com',
  };
  const virginia = new UsEast1Stack(app, 'ServerlessWebappStarterKitUsEast1Stack', {
    env: {
      account: props.account,
      region: 'us-east-1',
    },
    crossRegionReferences: true,
    domainName: props.domainName,
  });
  const mainStack = new MainStack(app, 'ServerlessWebappStarterKitStack', {
    env: {
      account: props.account,
      region: 'us-west-2',
    },
    crossRegionReferences: true,
    sharedCertificate: virginia.certificate,
    domainName: props.domainName,
    signPayloadHandler: virginia.signPayloadHandler,
  });
  const virginiaTemplate = Template.fromStack(virginia);
  const mainTemplate = Template.fromStack(mainStack);

  expect(virginiaTemplate).toMatchSnapshot();
  expect(mainTemplate).toMatchSnapshot();
});
