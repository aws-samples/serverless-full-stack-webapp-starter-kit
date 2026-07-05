import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const CLIENT_ID = 'testclient123';
const PROTECTED_URL = 'https://app.example.com/dashboard';

function requestWithCookie(cookie?: string) {
  return new NextRequest(new URL(PROTECTED_URL), cookie ? { headers: { cookie } } : undefined);
}

describe('proxy (optimistic auth check)', () => {
  const original = process.env.USER_POOL_CLIENT_ID;

  beforeEach(() => {
    process.env.USER_POOL_CLIENT_ID = CLIENT_ID;
  });

  afterEach(() => {
    process.env.USER_POOL_CLIENT_ID = original;
  });

  it('passes through when the Cognito LastAuthUser cookie is present', () => {
    const req = requestWithCookie(`CognitoIdentityServiceProvider.${CLIENT_ID}.LastAuthUser=user-abc`);
    const res = proxy(req);

    // NextResponse.next() sets this internal header.
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects to /sign-in when the cookie is absent', () => {
    const res = proxy(requestWithCookie());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.example.com/sign-in');
  });

  it('sets Content-Type and Cache-Control on the redirect (Lambda streaming / iOS Safari)', () => {
    const res = proxy(requestWithCookie());

    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not treat an empty cookie value as authenticated', () => {
    const res = proxy(requestWithCookie(`CognitoIdentityServiceProvider.${CLIENT_ID}.LastAuthUser=`));

    expect(res.status).toBe(307);
  });

  it('ignores a LastAuthUser cookie for a different client id', () => {
    const res = proxy(requestWithCookie('CognitoIdentityServiceProvider.other-client.LastAuthUser=user-abc'));

    expect(res.status).toBe(307);
  });

  it('does not block when USER_POOL_CLIENT_ID is unset (DAL performs the real check)', () => {
    delete process.env.USER_POOL_CLIENT_ID;
    const res = proxy(requestWithCookie());

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
