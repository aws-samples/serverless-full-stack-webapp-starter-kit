import { cache } from 'react';
import { cookies } from 'next/headers';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { prisma } from '@/lib/prisma';

/**
 * Get the authenticated session without DB access.
 * Use when only userId/email/accessToken is needed.
 * Memoized per request via React cache().
 */
export const getAuthSession = cache(async () => {
  const session = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => fetchAuthSession(contextSpec),
  });
  if (session.userSub == null || session.tokens?.idToken == null || session.tokens?.accessToken == null) {
    throw new Error('session not found');
  }
  const email = session.tokens.idToken.payload.email;
  if (typeof email != 'string') {
    throw new Error(`invalid email ${session.userSub}.`);
  }
  return {
    userId: session.userSub,
    email,
    accessToken: session.tokens.accessToken.toString(),
  };
});

/**
 * Try to get the authenticated session, returning null on failure.
 * Use in API Routes to avoid try/catch boilerplate for auth checks.
 */
export async function tryGetAuthSession() {
  try {
    return await getAuthSession();
  } catch {
    return null;
  }
}

/**
 * Get the authenticated session with the User record from DB.
 * Memoized per request via React cache().
 */
export const getSessionWithUser = cache(async () => {
  const auth = await getAuthSession();
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (user == null) {
    throw new UserNotFoundError(auth.userId);
  }
  return { ...auth, user };
});

export class UserNotFoundError {
  constructor(public readonly userId: string) {}
}
