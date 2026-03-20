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
  await runPrismaDbPush(options);
};

// Aurora Serverless v2 may be resuming from auto-pause (0 ACU) during CDK deployment,
// which takes approximately 15 seconds. Retry transient connection errors with exponential backoff.
// https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
async function runPrismaDbPush(options: string[], maxRetries = 5, baseDelay = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { exitCode, stdout, stderr } = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        path.resolve('./node_modules/prisma/build/index.js'),
        ['db', 'push', '--skip-generate'].concat(options),
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout,
            stderr,
          });
        },
      );
    });

    console.log(`prisma db push attempt ${attempt}/${maxRetries}`, { exitCode, stdout, stderr });

    if (exitCode === 0) return;

    const isRetryable =
      stderr.includes('P1001') || stderr.includes("Can't reach database") || stderr.includes('Connection refused');

    if (!isRetryable || attempt === maxRetries) {
      throw new Error(`prisma db push failed after ${attempt} attempt(s): ${stderr}`);
    }

    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
    console.log(`Retrying prisma db push in ${Math.round(delay)}ms...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}
