import { NextResponse } from 'next/server';
import { tryGetAuthSession } from '@/lib/auth';

export async function GET() {
  const session = await tryGetAuthSession();
  if (session == null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ accessToken: session.accessToken });
}
