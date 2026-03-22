import { NextResponse } from 'next/server';
import { tryGetAuthSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await tryGetAuthSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      accessToken: session.accessToken,
    });
  } catch (error) {
    console.error('Error fetching Cognito token:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
