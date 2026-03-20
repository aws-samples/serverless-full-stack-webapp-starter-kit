import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function AuthCallbackPage() {
  const { userId } = await getAuthSession();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user == null) {
    await prisma.user.create({ data: { id: userId } });
  }

  redirect('/');
}
