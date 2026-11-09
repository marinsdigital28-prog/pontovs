import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '../../../../lib/prisma';
import { requireAdmin } from '../../../../lib/admin-guard';
import { runAssistant } from '../../../../lib/assistant';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../lib/security-controls';
import { brazilDateKey } from '../../../../lib/brazil-time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(40) });
/** Teto de gasto do app (além do orçamento do AI Gateway): tokens por mês. ~3M tokens ≈ US$0,50 no modelo padrão. */
const monthlyCap = () => Number(process.env.PONTINHO_MONTHLY_TOKEN_CAP || 3_000_000);

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'O Pontinho é só para administradores.' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'pontinho', admin.id), 60, 3_600_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 });
  const usageKey = `pontinho.tokens.${brazilDateKey().slice(0, 7)}`;
  const used = Number((await prisma.appSetting.findUnique({ where: { key: usageKey } }).catch(() => null))?.value || 0);
  if (used >= monthlyCap()) return NextResponse.json({ error: 'O Pontinho atingiu o limite de uso deste mês (teto de gasto). Volta no dia 1º ou aumente PONTINHO_MONTHLY_TOKEN_CAP.' }, { status: 429 });
  const messages = parsed.data.messages.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  try {
    const out = await runAssistant({ messages, actor: { id: admin.id, name: admin.name } });
    const tokens = out.usage.input + out.usage.output;
    await prisma.appSetting.upsert({ where: { key: usageKey }, create: { key: usageKey, value: String(tokens) }, update: { value: String(used + tokens) } }).catch(() => undefined);
    await appendAuditEvent({ action: 'PONTINHO_PERGUNTA', actorId: admin.id, resource: 'Assistant', metadata: { pergunta: messages[messages.length - 1].content.slice(0, 500), ferramentas: out.toolsUsed, propostas: out.proposals.map((p) => p.id), tokens } });
    return NextResponse.json({ text: out.text, proposals: out.proposals });
  } catch (error) {
    const msg = String((error as Error)?.message || '');
    const friendly = /credit|budget|quota|insufficient|402/i.test(msg) ? 'Sem crédito no AI Gateway da Vercel (ou teto de gasto atingido).'
      : /auth|401|403|oidc|api key/i.test(msg) ? 'O AI Gateway não autorizou este projeto (ative o AI Gateway na Vercel).'
      : 'O Pontinho não conseguiu responder agora. Tente de novo.';
    await appendAuditEvent({ action: 'PONTINHO_FALHA', actorId: admin.id, resource: 'Assistant', metadata: { error: msg.slice(0, 300) } });
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
