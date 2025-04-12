import { prisma } from '@/lib/prisma';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { getCurrentUser } from 'aws-amplify/auth/server';
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action';
import { cookies } from 'next/headers';

export class MyCustomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MyCustomError';
  }
}

const actionClient = createSafeActionClient({
  handleServerError(e) {
    // Log to console.
    console.error('Action error:', e.message);

    // In this case, we can use the 'MyCustomError` class to unmask errors
    // and return them with their actual messages to the client.
    if (e instanceof MyCustomError) {
      return e.message;
    }

    // Every other error that occurs will be masked with the default message.
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

export const authActionClient = actionClient.use(async ({ next }) => {
  const currentUser = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => getCurrentUser(contextSpec),
  });

  if (!currentUser) {
    throw new Error('Session is not valid!');
  }

  const user = await prisma.user.findUnique({
    where: {
      id: currentUser.userId,
    },
  });

  if (user == null) {
    throw new Error('user not found');
  }

  return next({ ctx: { userId: user.id } });
});
