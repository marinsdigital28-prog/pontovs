import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendAuditEvent, consumeRateLimit, resetSecurityStateForTests, verifyAuditChain } from '../lib/security-controls';

afterEach(() => resetSecurityStateForTests());
const identifyRoute = readFileSync(resolve(process.cwd(), 'app/api/identify/route.ts'), 'utf8');
const punchRoute = readFileSync(resolve(process.cwd(), 'app/api/punch/route.ts'), 'utf8');

describe('security controls', () => {
  it('allows the configured number of requests and blocks the next one', async () => {
    const key = 'test:login:local';
    expect((await consumeRateLimit(key, 2, 60_000)).allowed).toBe(true);
    expect((await consumeRateLimit(key, 2, 60_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('protects public identification and punch endpoints with rate limiting', () => {
    expect(identifyRoute).toContain("getRequestKey(req, 'employee-identify')");
    expect(identifyRoute).toContain('if (!rate.allowed) return rateLimitResponse');
    expect(punchRoute).toContain("getRequestKey(req, 'punch-write')");
    expect(punchRoute).toContain('if (!rate.allowed) return rateLimitResponse');
  });

  it('creates and verifies an ordered audit hash chain', async () => {
    const first = await appendAuditEvent({ action: 'TEST_CREATED', resource: 'User', metadata: { safe: true } });
    const second = await appendAuditEvent({ action: 'TEST_UPDATED', resource: 'User', resourceId: '1' });
    expect(second.previousHash).toBe(first.hash);
    expect(await verifyAuditChain()).toBe(true);
  });
});

it('connects to configured Redis when credentials are available', async () => {
  if (!process.env.UPSTASH_REDIS_REST_URL?.startsWith('https://') || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();
  expect(await redis.ping()).toBe('PONG');
});
