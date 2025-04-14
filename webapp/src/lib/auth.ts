import { cookies } from 'next/headers';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { prisma } from '@/lib/prisma';

export class UserNotCreatedError {
  constructor(public readonly userId: string) {}
}

export async function getSession() {
  const session = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => fetchAuthSession(contextSpec),
  });
  if (session.userSub == null || session.tokens?.idToken == null || session.tokens?.accessToken == null) {
    throw new Error('session not found');
  }
  const userId = session.userSub;
  const email = session.tokens.idToken.payload.email;
  if (typeof email != 'string') {
    throw new Error(`invalid email ${userId}.`);
  }
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
  if (user == null) {
    throw new UserNotCreatedError(userId);
  }

  return {
    userId: user.id,
    email,
    accessToken: session.tokens.accessToken.toString(),
    user,
  };
}
