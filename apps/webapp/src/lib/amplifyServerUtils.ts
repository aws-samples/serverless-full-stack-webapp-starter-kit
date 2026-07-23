import { createServerRunner } from '@aws-amplify/adapter-nextjs';
import type { NextServer } from '@aws-amplify/adapter-nextjs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

type CreateServerRunnerRuntimeOptions = NextServer.CreateServerRunnerRuntimeOptions;

if (process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER) {
  const ssm = new SSMClient({});
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER }));
    process.env.AMPLIFY_APP_ORIGIN = res.Parameter?.Value;
  } catch (e) {
    console.log(e);
  }
}

export const { runWithAmplifyServerContext, createAuthRouteHandlers } = createServerRunner({
  config: {
    Auth: {
      Cognito: {
        userPoolId: process.env.USER_POOL_ID!,
        userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
        loginWith: {
          oauth: {
            redirectSignIn: [`${process.env.AMPLIFY_APP_ORIGIN!}/api/auth/sign-in-callback`],
            redirectSignOut: [`${process.env.AMPLIFY_APP_ORIGIN!}/api/auth/sign-out-callback`],
            responseType: 'code',
            domain: process.env.COGNITO_DOMAIN!,
            scopes: ['profile', 'openid', 'aws.cognito.signin.user.admin'],
          },
        },
      },
    },
  },
  runtimeOptions: {
    // `httpOnly`/`secure` are supported by the underlying cookie storage but omitted from
    // the adapter's public `cookies` type, so a cast is required here.
    cookies: {
      sameSite: 'lax',
      httpOnly: true,
      secure: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    } as CreateServerRunnerRuntimeOptions['cookies'],
  },
});
