import { redirect } from 'next/navigation';
import { getSession, UserNotCreatedError } from '@/lib/auth';
import { db } from '@repo/db/client';
import { users } from '@repo/db/schema';

export const dynamic = 'force-dynamic';

export default async function AuthCallbackPage() {
  try {
    await getSession();
  } catch (e) {
    console.log(e);
    if (e instanceof UserNotCreatedError) {
      const userId = e.userId;
      console.log(userId);
      await db.insert(users).values({ id: userId }).onConflictDoNothing();
    } else {
      throw e;
    }
  }
  redirect('/');
}
