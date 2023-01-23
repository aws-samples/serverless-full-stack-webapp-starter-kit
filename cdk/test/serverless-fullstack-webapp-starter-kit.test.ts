import * as cdk from "aws-cdk-lib";
import { Template } from 'aws-cdk-lib/assertions';
import { ServerlessFullstackWebappStarterKitStack } from "../lib/serverless-fullstack-webapp-starter-kit-stack";

test("Snapshot test", () => {
  const app = new cdk.App();
  const stack = new ServerlessFullstackWebappStarterKitStack(app, "TestStack");
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
