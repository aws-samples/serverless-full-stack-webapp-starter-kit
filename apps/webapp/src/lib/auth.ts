import { cache } from 'react';
import { cookies } from 'next/headers';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { db } from '@repo/db/client';
import { users } from '@repo/db/schema';
import { eq } from 'drizzle-orm';

export class UserNotCreatedError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} not found in database`);
    this.name = 'UserNotCreatedError';
  }
}

/**
 * Get the authenticated session only (no DB access).
 * Use when only userId/token is needed (e.g. API routes).
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
  const userId = session.userSub;
  const email = session.tokens.idToken.payload.email;
  if (typeof email != 'string') {
    throw new Error(`invalid email ${userId}.`);
  }
  return {
    userId,
    email,
    accessToken: session.tokens.accessToken.toString(),
  };
});

/**
 * Get the authenticated session, returning null on failure.
 * Use in API routes to return 401 instead of throwing.
 */
export async function tryGetAuthSession() {
  try {
    return await getAuthSession();
  } catch {
    return null;
  }
}

/**
 * Get the authenticated session plus the DB user record.
 * Throws UserNotCreatedError when the user row does not exist yet.
 * Memoized per request via React cache().
 */
export const getSessionWithUser = cache(async () => {
  const authSession = await getAuthSession();
  const user = await db.query.users.findFirst({
    where: eq(users.id, authSession.userId),
  });
  if (user == null) {
    throw new UserNotCreatedError(authSession.userId);
  }
  return {
    ...authSession,
    user,
  };
});
