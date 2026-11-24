import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Cloudflare Workers:
 * - Um PrismaClient (e um pool pg) POR REQUISIÇÃO, reaproveitando a conexão entre as
 *   várias queries da mesma requisição (antes: 1 conexão TCP+TLS nova por query).
 * - Workers proíbe usar I/O de uma requisição em outra, então nada é compartilhado
 *   entre requisições. Sem timers de idle (idleTimeoutMillis: 0): o runtime fecha os
 *   sockets quando a requisição termina.
 * - Fora de uma requisição (build/scripts) cai num cliente global sem reuso.
 */
function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL
  );
}

function createClient(perRequest: boolean) {
  const adapter = new PrismaPg(
    perRequest
      ? { connectionString: connectionString(), max: 2, idleTimeoutMillis: 0 }
      : { connectionString: connectionString(), max: 5, maxUses: 1, idleTimeoutMillis: 1 },
  );
  return new PrismaClient({ adapter });
}

const perRequestClients = new WeakMap<object, PrismaClient>();
let fallbackClient: PrismaClient | undefined;

function currentClient(): PrismaClient {
  let ctx: object | undefined;
  try {
    ctx = getCloudflareContext().ctx as unknown as object;
  } catch {
    ctx = undefined;
  }
  if (ctx) {
    let client = perRequestClients.get(ctx);
    if (!client) {
      client = createClient(true);
      perRequestClients.set(ctx, client);
    }
    return client;
  }
  return (fallbackClient ??= createClient(false));
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = currentClient() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default prisma;
