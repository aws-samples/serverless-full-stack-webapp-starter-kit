import { beforeEach, describe, expect, it, vi } from 'vitest';

// React cache() only memoizes inside a Server Component request; in unit tests
// we replace it with an identity wrapper so the underlying logic is exercised
// directly. Per-request deduplication is React's responsibility and is a
// runtime (RSC) behavior, not verifiable in a plain Node test.
vi.mock('react', () => ({ cache: <T>(fn: T): T => fn }));

// runWithAmplifyServerContext simply invokes the operation with a context spec.
vi.mock('@/lib/amplifyServerUtils', () => ({
  runWithAmplifyServerContext: vi.fn(({ operation }: { operation: (spec: unknown) => unknown }) => operation({})),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

const fetchAuthSession = vi.fn();
vi.mock('aws-amplify/auth/server', () => ({ fetchAuthSession: (...args: unknown[]) => fetchAuthSession(...args) }));

const findFirst = vi.fn();
vi.mock('@repo/db/client', () => ({
  db: { query: { users: { findFirst: (...args: unknown[]) => findFirst(...args) } } },
}));
vi.mock('@repo/db/schema', () => ({ users: { id: 'id' } }));

import { getAuthSession, getSessionWithUser, tryGetAuthSession, UserNotCreatedError } from './auth';

function validSession(overrides: Record<string, unknown> = {}) {
  return {
    userSub: 'user-1',
    tokens: {
      idToken: { payload: { email: 'user@example.com' } },
      accessToken: { toString: () => 'access-token-value' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  fetchAuthSession.mockReset();
  findFirst.mockReset();
});

describe('getAuthSession', () => {
  it('returns userId, email and accessToken for a valid session', async () => {
    fetchAuthSession.mockResolvedValue(validSession());

    await expect(getAuthSession()).resolves.toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      accessToken: 'access-token-value',
    });
  });

  it('throws when tokens are missing', async () => {
    fetchAuthSession.mockResolvedValue({ userSub: null, tokens: undefined });

    await expect(getAuthSession()).rejects.toThrow('session not found');
  });

  it('throws when the email claim is not a string', async () => {
    fetchAuthSession.mockResolvedValue(
      validSession({ tokens: { idToken: { payload: { email: 123 } }, accessToken: { toString: () => 'x' } } }),
    );

    await expect(getAuthSession()).rejects.toThrow('invalid email');
  });
});

describe('tryGetAuthSession', () => {
  it('returns the session on success', async () => {
    fetchAuthSession.mockResolvedValue(validSession());

    await expect(tryGetAuthSession()).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('returns null instead of throwing on failure', async () => {
    fetchAuthSession.mockResolvedValue({ userSub: null });

    await expect(tryGetAuthSession()).resolves.toBeNull();
  });
});

describe('getSessionWithUser', () => {
  it('returns the auth session merged with the DB user record', async () => {
    fetchAuthSession.mockResolvedValue(validSession());
    findFirst.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });

    const result = await getSessionWithUser();

    expect(result.userId).toBe('user-1');
    expect(result.user).toEqual({ id: 'user-1', email: 'user@example.com' });
  });

  it('throws UserNotCreatedError carrying the userId when the DB row is missing', async () => {
    fetchAuthSession.mockResolvedValue(validSession());
    findFirst.mockResolvedValue(undefined);

    const error = await getSessionWithUser().then(
      () => {
        throw new Error('expected getSessionWithUser to throw');
      },
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UserNotCreatedError);
    expect((error as UserNotCreatedError).userId).toBe('user-1');
  });
});
