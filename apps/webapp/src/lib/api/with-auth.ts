import { NextResponse } from 'next/server';
import { tryGetAuthSession } from '@/lib/auth';

type Session = NonNullable<Awaited<ReturnType<typeof tryGetAuthSession>>>;

/**
 * Auth guardrail for API Route handlers. Resolves the session and returns 401
 * when unauthenticated; otherwise runs the handler and JSON-encodes its result.
 */
export async function withAuth<T>(handler: (session: Session) => Promise<T>): Promise<NextResponse> {
  const session = await tryGetAuthSession();
  if (session == null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await handler(session);
  return NextResponse.json(result);
}
