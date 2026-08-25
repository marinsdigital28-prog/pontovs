import { describe, expect, it } from 'vitest';

const baseUrl = process.env.ADMIN_TEST_BASE_URL ?? 'https://ponto.marinsdistemas.xyz';
const password = process.env.ADMIN_ACCESS_PASSWORD;

describe('admin password authentication', () => {
  it('exposes only the password credential and accepts the configured password', async () => {
    expect(password).toBeTruthy();

    const providersResponse = await fetch(`${baseUrl}/api/auth/providers`);
    expect(providersResponse.status).toBe(200);
    const providers = await providersResponse.json() as Record<string, Record<string, unknown>>;
    expect(providers.credentials).toBeTruthy();
    expect(Object.keys(providers.credentials ?? {}).sort()).toEqual(['callbackUrl', 'id', 'name', 'signinUrl', 'type'].sort());

    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
    expect(csrfResponse.status).toBe(200);
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const cookie = (csrfResponse.headers.get('set-cookie') ?? '').split(';')[0];

    const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
      },
      body: new URLSearchParams({ csrfToken, password: password as string, callbackUrl: '/admin', json: 'true' }),
      redirect: 'manual',
    });

    expect([200, 302, 303]).toContain(loginResponse.status);
    expect(loginResponse.headers.get('set-cookie')).toBeTruthy();
  }, 30_000);
});
