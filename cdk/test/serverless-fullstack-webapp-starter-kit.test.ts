import * as cdk from "aws-cdk-lib";
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from "../lib/main-stack";

test("Snapshot test", () => {
  const app = new cdk.App();
  const stack = new MainStack(app, "TestStack");
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
