import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes, randomInt } from 'node:crypto';

type E2EUser = {
  email: string;
  password: string;
};

function requiredEnvironment(name: 'E2E_USER_POOL_ID' | 'E2E_AWS_REGION') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function generatePassword() {
  const requiredCharacters = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%^&*_-'];
  const characters = requiredCharacters.join('');
  const password = requiredCharacters.map((set) => set[randomInt(set.length)]);

  while (password.length < 12) {
    password.push(characters[randomInt(characters.length)]);
  }

  for (let index = password.length - 1; index > 0; index -= 1) {
    const replacement = randomInt(index + 1);
    [password[index], password[replacement]] = [password[replacement], password[index]];
  }

  return password.join('');
}

function createUser(label: 'a' | 'b'): E2EUser {
  return {
    email: `e2e-user-${label}-${randomBytes(4).toString('hex')}@e2e.test`,
    password: generatePassword(),
  };
}

async function createCognitoUser(client: CognitoIdentityProviderClient, userPoolId: string, user: E2EUser) {
  try {
    // On email-alias pools (signInAliases: email), passing the email as Username
    // is the documented pattern: Cognito treats it as an alias for the email attribute.
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: user.email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: user.email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'UsernameExistsException') {
      throw error;
    }

    await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: user.email }));
    return createCognitoUser(client, userPoolId, user);
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: user.email,
      Password: user.password,
      Permanent: true,
    }),
  );
}

async function main() {
  const userPoolId = requiredEnvironment('E2E_USER_POOL_ID');
  const region = requiredEnvironment('E2E_AWS_REGION');
  const client = new CognitoIdentityProviderClient({ region });
  const userA = createUser('a');
  const userB = createUser('b');

  process.stderr.write(`Creating E2E users in ${userPoolId}.\n`);
  await createCognitoUser(client, userPoolId, userA);
  await createCognitoUser(client, userPoolId, userB);
  process.stderr.write('Created two E2E users. Capture the exports below without committing them.\n');

  process.stdout.write(`export E2E_USER_A_EMAIL='${userA.email}'\n`);
  process.stdout.write(`export E2E_USER_A_PASSWORD='${userA.password}'\n`);
  process.stdout.write(`export E2E_USER_B_EMAIL='${userB.email}'\n`);
  process.stdout.write(`export E2E_USER_B_PASSWORD='${userB.password}'\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Failed to provision E2E users: ${message}\n`);
  process.exitCode = 1;
});
