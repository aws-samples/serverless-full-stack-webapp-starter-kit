import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

function requiredEnvironment(name: 'E2E_USER_POOL_ID' | 'E2E_AWS_REGION' | 'E2E_USER_A_EMAIL' | 'E2E_USER_B_EMAIL') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function deleteUser(client: CognitoIdentityProviderClient, userPoolId: string, email: string) {
  try {
    // On email-alias pools, Cognito resolves the email to the underlying user.
    await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }));
    process.stderr.write(`Deleted E2E user ${email}.\n`);
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      process.stderr.write(`E2E user ${email} was already absent.\n`);
      return;
    }
    throw error;
  }
}

async function main() {
  const userPoolId = requiredEnvironment('E2E_USER_POOL_ID');
  const region = requiredEnvironment('E2E_AWS_REGION');
  const client = new CognitoIdentityProviderClient({ region });

  await Promise.all([
    deleteUser(client, userPoolId, requiredEnvironment('E2E_USER_A_EMAIL')),
    deleteUser(client, userPoolId, requiredEnvironment('E2E_USER_B_EMAIL')),
  ]);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Failed to clean up E2E users: ${message}\n`);
  process.exitCode = 1;
});
