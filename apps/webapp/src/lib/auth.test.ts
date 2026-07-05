import { beforeEach, describe, expect, it, vi } from 'vitest';

// React cache() only memoizes inside a server request; in unit tests we override
// only `cache` with an identity wrapper while preserving the rest of the React
// module (via importOriginal), so the underlying logic is exercised directly.
// Per-request deduplication is React's responsibility and is a runtime behavior,
// not verifiable in a plain Node test.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T>(fn: T): T => fn };
});

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

import {
  getAuthSession,
  getSessionWithUser,
  tryGetAuthSession,
  UnauthenticatedError,
  UserNotCreatedError,
} from './auth';

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

  it('throws UnauthenticatedError when tokens are missing', async () => {
    fetchAuthSession.mockResolvedValue({ userSub: null, tokens: undefined });

    await expect(getAuthSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('throws a non-UnauthenticatedError (propagated as an unexpected failure) for a malformed email claim', async () => {
    fetchAuthSession.mockResolvedValue(
      validSession({ tokens: { idToken: { payload: { email: 123 } }, accessToken: { toString: () => 'x' } } }),
    );

    const error = await getAuthSession().then(
      () => {
        throw new Error('expected getAuthSession to throw');
      },
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnauthenticatedError);
    expect((error as Error).message).toContain('invalid email');
  });
});

describe('tryGetAuthSession', () => {
  it('returns the session on success', async () => {
    fetchAuthSession.mockResolvedValue(validSession());

    await expect(tryGetAuthSession()).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('returns null when the user is not authenticated', async () => {
    fetchAuthSession.mockResolvedValue({ userSub: null });

    await expect(tryGetAuthSession()).resolves.toBeNull();
  });

  it('re-throws unexpected errors instead of masking them as null (avoids a misleading 401)', async () => {
    fetchAuthSession.mockRejectedValue(new Error('transient JWKS fetch failure'));

    await expect(tryGetAuthSession()).rejects.toThrow('transient JWKS fetch failure');
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
