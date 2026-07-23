import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryGetAuthSession = vi.fn();
vi.mock('@/lib/auth', () => ({ tryGetAuthSession: (...args: unknown[]) => tryGetAuthSession(...args) }));

import { withAuth } from './with-auth';

beforeEach(() => {
  tryGetAuthSession.mockReset();
});

describe('withAuth', () => {
  it('returns 401 when there is no authenticated session', async () => {
    tryGetAuthSession.mockResolvedValue(null);
    const handler = vi.fn();

    const res = await withAuth(handler);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls the handler and returns its result when authenticated', async () => {
    const session = {
      userId: 'user-1',
      email: 'user@example.com',
      accessToken: 'access-token-value',
    };
    tryGetAuthSession.mockResolvedValue(session);
    const handler = vi.fn().mockResolvedValue({ accessToken: session.accessToken });

    const res = await withAuth(handler);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accessToken: 'access-token-value' });
    expect(handler).toHaveBeenCalledWith(session);
  });
});
