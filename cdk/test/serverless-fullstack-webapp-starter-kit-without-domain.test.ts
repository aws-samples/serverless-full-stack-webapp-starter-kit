import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

test('Snapshot test', () => {
  jest.useFakeTimers().setSystemTime(new Date('2020-01-01'));

  const app = new cdk.App();
  const props = {
    account: '123456789012',
  };
  const virginia = new UsEast1Stack(app, 'ServerlessWebappStarterKitUsEast1Stack', {
    env: {
      account: props.account,
      region: 'us-east-1',
    },
    crossRegionReferences: true,
  });
  const mainStack = new MainStack(app, 'ServerlessWebappStarterKitStack', {
    env: {
      account: props.account,
      region: 'us-west-2',
    },
    crossRegionReferences: true,
    signPayloadHandler: virginia.signPayloadHandler,
  });
  const virginiaTemplate = Template.fromStack(virginia);
  const mainTemplate = Template.fromStack(mainStack);

  expect(virginiaTemplate).toMatchSnapshot();
  expect(mainTemplate).toMatchSnapshot();
});
