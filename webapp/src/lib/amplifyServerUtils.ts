import { createServerRunner } from '@aws-amplify/adapter-nextjs';

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
    cookies: {
      domain: process.env.HOST_DOMAIN!, // making cookies available to all subdomains
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  },
});
