// Entrada do Worker: OpenNext (fetch) + Cron Triggers (scheduled).
// Os crons chamam as mesmas rotas que a Vercel chamava, dentro do próprio Worker
// (sem ida pela rede), com o header Authorization: Bearer CRON_SECRET.
// @ts-ignore: gerado pelo build do OpenNext
import openNext from "./.open-next/worker.js";
// @ts-ignore
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

// Mesmas expressões (UTC) do vercel.json.
const CRONS = {
  "20 20 * * *": "/api/cron/auto-close",       // 17:20 Brasília — fecha o dia de hoje
  "0 11 * * *": "/api/cron/auto-close/manha", // 08:00 Brasília — re-confere ontem
};

export default {
  fetch: openNext.fetch,
  async scheduled(event, env, ctx) {
    const path = CRONS[event.cron];
    if (!path) { console.warn("cron sem rota:", event.cron); return; }
    const origin = env.NEXTAUTH_URL || "https://ponto.marinsdistemas.xyz";
    const req = new Request(origin + path, {
      method: "GET",
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, "user-agent": "cloudflare-cron" },
    });
    const res = await openNext.fetch(req, env, ctx);
    const body = await res.text();
    console.log(JSON.stringify({ cron: event.cron, path, status: res.status, body: body.slice(0, 2000) }));
    if (!res.ok) throw new Error(`cron ${path} -> HTTP ${res.status}`);
  },
};
