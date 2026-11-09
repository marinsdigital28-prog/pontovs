import { NextResponse } from 'next/server';
// Handler compartilhado pelas rotas /api/cron/auto-close e /api/cron/auto-close/manha.
import { timingSafeEqual } from 'node:crypto';
import { brazilDateKey } from './brazil-time';
import { getAutoCloseMode, runAutoClose } from './auto-close-server';
import type { Phase } from './auto-close';


function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false; // sem segredo configurado, ninguém roda (projetos-cópia ficam inertes)
  const got = request.headers.get('authorization') || '';
  const want = `Bearer ${secret}`;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Vercel Cron:
 *  - 20:20 UTC (17:20 Brasília): phase=TARDE, dia de hoje.
 *  - 11:00 UTC (08:00 Brasília): phase=MANHA, ontem — só quem tem escala terminando depois das 17:20.
 * Parâmetros manuais (com o mesmo segredo): ?date=YYYY-MM-DD&phase=COMPLETO&preview=1 (preview = só relatório, nada gravado).
 */
export async function handle(request: Request, forcedPhase?: Phase) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const now = new Date();
  const phaseParam = String(forcedPhase || url.searchParams.get('phase') || 'TARDE').toUpperCase();
  const phase: Phase = phaseParam === 'MANHA' ? 'MANHA' : phaseParam === 'COMPLETO' ? 'COMPLETO' : 'TARDE';
  const dateParam = url.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : brazilDateKey(phase === 'MANHA' ? new Date(now.getTime() - 24 * 3600_000) : now);
  const preview = url.searchParams.get('preview') === '1';
  const mode = await getAutoCloseMode();
  const result = await runAutoClose({ date, phase, mode, persist: !preview, trigger: 'cron' });
  return NextResponse.json(result);
}
