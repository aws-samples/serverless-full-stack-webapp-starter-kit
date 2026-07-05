import { withAuth } from '@/lib/api/with-auth';

export const GET = () => withAuth(async (session) => ({ accessToken: session.accessToken }));
