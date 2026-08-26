import { createHash, randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Prisma } from '@prisma/client';
import prisma from './prisma';

export type AuditEvent = {
  id: string;
  action: string;
  actorId?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  previousHash: string;
  hash: string;
};

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const auditEvents: AuditEvent[] = [];
const GENESIS = 'PONTO_PROGREDIR_AUDIT_GENESIS_V1';
let redisClient: Redis | null | undefined;

function getRedis() {
  if (redisClient !== undefined) return redisClient;
  if (!process.env.UPSTASH_REDIS_REST_URL?.startsWith('https://') || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClient = null;
    return redisClient;
  }
  try { redisClient = Redis.fromEnv(); } catch { redisClient = null; }
  return redisClient;
}

export function getRequestKey(request: Request, scope: string, identity = '') {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'local';
  return `${scope}:${identity}:${ip}`;
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const redis = getRedis();
  if (redis) {
    try {
      const redisKey = `ponto:ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, Math.ceil(windowMs / 1000));
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.ceil(windowMs / 1000), backend: 'redis' as const };
    } catch {
      // Fall through to the local guard. Availability is preferred to an unprotected request.
    }
  }
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000), backend: 'memory' as const };
  }
  existing.count += 1;
  return { allowed: existing.count <= limit, remaining: Math.max(0, limit - existing.count), retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000), backend: 'memory' as const };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds), 'Cache-Control': 'no-store' } });
}

function hashEvent(base: Omit<AuditEvent, 'hash'>) {
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

export async function appendAuditEvent(input: Omit<AuditEvent, 'id' | 'createdAt' | 'previousHash' | 'hash'>) {
  try {
    const event = await prisma.$transaction(async (tx) => {
      const previous = await tx.securityAuditEvent.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { hash: true } });
      const base = { id: randomUUID(), action: input.action, actorId: input.actorId ?? null, resource: input.resource ?? null, resourceId: input.resourceId ?? null, metadata: input.metadata, createdAt: new Date().toISOString(), previousHash: previous?.hash ?? GENESIS };
      const hash = hashEvent(base);
      await tx.securityAuditEvent.create({ data: { id: base.id, action: base.action, actorId: base.actorId, resource: base.resource, resourceId: base.resourceId, metadataJson: base.metadata ? JSON.stringify(base.metadata) : null, createdAt: new Date(base.createdAt), previousHash: base.previousHash, hash } });
      return { ...base, hash };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    auditEvents.push(event);
    return event;
  } catch {
    const previousHash = auditEvents.at(-1)?.hash ?? GENESIS;
    const base = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), previousHash };
    const event = { ...base, hash: hashEvent(base) };
    auditEvents.push(event);
    return event;
  }
}

function fromDb(row: { id: string; action: string; actorId: string | null; resource: string | null; resourceId: string | null; metadataJson: string | null; createdAt: Date; previousHash: string; hash: string }): AuditEvent {
  let metadata: Record<string, unknown> | undefined;
  try { metadata = row.metadataJson ? JSON.parse(row.metadataJson) : undefined; } catch { metadata = undefined; }
  return { id: row.id, action: row.action, actorId: row.actorId, resource: row.resource, resourceId: row.resourceId, metadata, createdAt: row.createdAt.toISOString(), previousHash: row.previousHash, hash: row.hash };
}

export async function getAuditEvents(limit = 100) {
  try {
    const rows = await prisma.securityAuditEvent.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(fromDb);
  } catch {
    return auditEvents.slice(-limit).reverse();
  }
}

export async function verifyAuditChain() {
  const events = (await getAuditEvents(5000)).reverse();
  let previousHash = GENESIS;
  for (const event of events) {
    const { hash, ...base } = event;
    if (event.previousHash !== previousHash || hash !== hashEvent(base)) return false;
    previousHash = hash;
  }
  return true;
}

export function resetSecurityStateForTests() {
  buckets.clear();
  auditEvents.length = 0;
  redisClient = undefined;
}
