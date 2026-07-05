import { beforeEach, describe, expect, it, vi } from 'vitest';

const tryGetAuthSession = vi.fn();
vi.mock('@/lib/auth', () => ({ tryGetAuthSession: (...args: unknown[]) => tryGetAuthSession(...args) }));

import { GET } from './route';

beforeEach(() => {
  tryGetAuthSession.mockReset();
});

describe('GET /api/cognito-token', () => {
  it('returns 401 when there is no authenticated session', async () => {
    tryGetAuthSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns the access token when authenticated', async () => {
    tryGetAuthSession.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      accessToken: 'access-token-value',
    });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accessToken: 'access-token-value' });
  });
});
