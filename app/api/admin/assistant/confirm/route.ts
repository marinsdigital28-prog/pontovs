import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '../../../../../lib/admin-guard';
import { cancelAction, confirmAction } from '../../../../../lib/assistant-actions';
import { consumeRateLimit, getRequestKey, rateLimitResponse } from '../../../../../lib/security-controls';

export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.string().min(1),
  decision: z.enum(['CONFIRMAR', 'CANCELAR']),
  document: z.object({ name: z.string().max(180), mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']), data: z.string().max(14_000_000) }).nullable().optional(),
});

/** Botão Confirmar/Cancelar do cartão "Mudança proposta" (clique humano). O modelo nunca chama esta rota. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Só administradores.' }, { status: 401 });
  const rate = await consumeRateLimit(getRequestKey(request, 'pontinho-confirm', admin.id), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  try {
    if (parsed.data.decision === 'CANCELAR') { await cancelAction(parsed.data.id, admin.id); return NextResponse.json({ ok: true, status: 'CANCELADA' }); }
    const result = await confirmAction(parsed.data.id, admin.id, parsed.data.document || null);
    return NextResponse.json({ ok: true, status: 'CONFIRMADA', result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Não foi possível gravar.' }, { status: 409 });
  }
}
