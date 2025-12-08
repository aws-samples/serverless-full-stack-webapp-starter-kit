import { Handler } from 'aws-lambda';
import { execFile } from 'child_process';
import path from 'path';

export const handler: Handler = async (event, _) => {
  // This Lambda function is invoked in two contexts:
  // 1. CDK Trigger: Automatically invoked during `cdk deploy` with default payload (no command specified, defaults to 'deploy')
  // 2. Manual Invocation: Use AWS CLI to invoke with custom commands
  //    Example: aws lambda invoke --function-name <FUNCTION_NAME> --payload '{"command":"force"}' --cli-binary-format raw-in-base64-out /dev/stdout
  //    The function name and command template are available in the CloudFormation stack outputs after deployment
  //
  // Available commands are:
  //   deploy: create new database if absent and apply all migrations to the existing database.
  //   reset: delete existing database, create new one, and apply all migrations. NOT for production environment.
  // If you want to add commands, please refer to: https://www.prisma.io/docs/concepts/components/prisma-migrate
  const command: string = event.command ?? 'deploy';

  let options: string[] = [];

  if (command == 'force') {
    options = ['--accept-data-loss'];
  } else if (command == 'reset') {
    options = ['--force-reset'];
    throw new Error('reset command is forbidden!');
  }

  // Currently we don't have any direct method to invoke prisma migration programmatically.
  // As a workaround, we spawn migration script as a child process and wait for its completion.
  // Please also refer to the following GitHub issue: https://github.com/prisma/prisma/issues/4703
  try {
    const exitCode = await new Promise((resolve, _) => {
      execFile(
        path.resolve('./node_modules/prisma/build/index.js'),
        ['db', 'push', '--skip-generate'].concat(options),
        (error, stdout, stderr) => {
          console.log(stdout);
          if (error != null) {
            console.log(`prisma db push exited with error ${error.message}`);
            resolve(error.code ?? 1);
          } else {
            resolve(0);
          }
        },
      );
    });

    if (exitCode != 0) throw Error(`db push failed with exit code ${exitCode}`);
  } catch (e) {
    console.log(e);
    throw e;
  }
};
