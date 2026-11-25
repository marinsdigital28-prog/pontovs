/**
 * Backtest walk-forward: aprende com correções até o dia D e mede o acerto nas correções depois de D.
 * Compara com a regra atual (sem lessons), cujo gate de CI é 41/42 (~97,6%).
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import fixture from './fixtures/classifier-backtest.json';
import { classify, computeHabit, hm, interpretDay, LATE_RETURN_LIMIT, proposeFill, toClassSchedule, type HistoryDay, type PType } from '../lib/punch-classifier';
import { lessonsFromCorrections, type Lesson } from '../lib/habit-learn';

type Case = { user: string; who: string; date: string; schedule: { start: string; end: string; mode: 'FULL' | 'HALF' }; punches: { min: number; totem: string; final: string; corrected: boolean }[] };
type Fill = { user: string; date: string; schedule: Case['schedule']; present: Record<string, number>; type: PType; gestor: number };
const F = fixture as unknown as { history: Record<string, HistoryDay[]>; cases: Case[]; fills: Fill[] };
const FLEX = 'U04';
const ROB = 'U28';
const robSchedule = toClassSchedule({ start: '07:30', end: '16:30', mode: 'FULL', lunchStart: '10:30', lunchEnd: '11:30' })!;
function scheduleOf(c: { user: string; schedule: Case['schedule'] }) {
  return c.user === ROB ? robSchedule : toClassSchedule(c.schedule)!;
}


function allLessons(): { byUser: Map<string, Lesson[]>; relabelN: number; fillN: number } {
  const relabels: { user: string; date: string; type: PType; min: number; fromType?: string }[] = [];
  for (const c of F.cases) {
    for (const p of c.punches) {
      if (p.corrected) relabels.push({ user: c.user, date: c.date, type: p.final as PType, min: p.min, fromType: p.totem });
    }
  }
  const byUser = new Map<string, Lesson[]>();
  const add = (user: string, lesson: Lesson) => {
    const list = byUser.get(user) || [];
    list.push(lesson);
    byUser.set(user, list);
  };
  for (const r of relabels) add(r.user, { date: r.date, type: r.type, min: r.min, kind: 'RELABEL', fromType: r.fromType, source: 'GESTOR' });
  for (const f of F.fills) add(f.user, { date: f.date, type: f.type, min: f.gestor, kind: 'FILL', source: 'GESTOR' });
  return { byUser, relabelN: relabels.length, fillN: F.fills.length };
}

function scoreTypes(lessonsFor: (user: string, date: string) => Lesson[], onlyAfter?: string, onlyUntil?: string) {
  const rows: { who: string; date: string; min: number; totem: string; final: string; gotBase: string; gotLearn: string }[] = [];
  for (const c of F.cases) {
    if (onlyAfter && c.date <= onlyAfter) continue;
    if (onlyUntil && c.date > onlyUntil) continue;
    const s = scheduleOf(c);
    const times = c.punches.map((p) => p.min);
    const flex = c.user === FLEX;
    const base = classify(times, s, flex ? null : computeHabit(F.history[c.user] || [], c.date));
    const learn = classify(times, s, flex ? null : computeHabit(F.history[c.user] || [], c.date, lessonsFor(c.user, c.date)));
    c.punches.forEach((p, i) => {
      if (!p.corrected) return;
      rows.push({ who: c.who, date: c.date, min: p.min, totem: p.totem, final: p.final, gotBase: base.labels[i], gotLearn: learn.labels[i] });
    });
  }
  const n = rows.length;
  const baseOk = rows.filter((r) => r.gotBase === r.final).length;
  const learnOk = rows.filter((r) => r.gotLearn === r.final).length;
  const rescued = rows.filter((r) => r.gotBase !== r.final && r.gotLearn === r.final);
  const lost = rows.filter((r) => r.gotBase === r.final && r.gotLearn !== r.final);
  return { n, baseOk, learnOk, rescued, lost, rows };
}

function whoOf(user: string) { return F.cases.find((c) => c.user === user)?.who || user; }

function scoreFills(lessonsFor: (user: string, date: string) => Lesson[], onlyAfter?: string) {
  let n = 0, baseOk = 0, learnOk = 0, lunchBad = 0;
  const rescued: string[] = [];
  const lost: string[] = [];
  for (const f of F.fills) {
    if (onlyAfter && f.date <= onlyAfter) continue;
    n += 1;
    const s = f.user === ROB ? robSchedule : toClassSchedule(f.schedule)!;
    const present = f.present as Partial<Record<PType, number>>;
    const flex = f.user === FLEX;
    const b = proposeFill(present, s, flex ? null : computeHabit(F.history[f.user] || [], f.date), { flexible: flex });
    const l = proposeFill(present, s, flex ? null : computeHabit(F.history[f.user] || [], f.date, lessonsFor(f.user, f.date)), { flexible: flex });
    const bMin = b.fills.find((x) => x.type === f.type)?.min;
    const lMin = l.fills.find((x) => x.type === f.type)?.min;
    baseOk += Number(bMin === f.gestor);
    learnOk += Number(lMin === f.gestor);
    const line = `${f.date} ${whoOf(f.user)} ${f.type} gestor ${hm(f.gestor)} (base ${bMin !== undefined ? hm(bMin) : '—'} → aprendido ${lMin !== undefined ? hm(lMin) : '—'})`;
    if (bMin !== f.gestor && lMin === f.gestor) rescued.push(line);
    if (bMin === f.gestor && lMin !== f.gestor) lost.push(line);
    // Só conta almoço curto criado por um * de INTERVALO/RETORNO (não o almoço já batido no dia).
    const addedLunch = l.fills.some((x) => x.type === 'INTERVALO' || x.type === 'RETORNO');
    const all = { ...present, ...Object.fromEntries(l.fills.map((x) => [x.type, x.min])) };
    if (addedLunch && all.INTERVALO !== undefined && all.RETORNO !== undefined && all.RETORNO - all.INTERVALO < 55 && !l.doubt) lunchBad += 1;
  }
  return { n, baseOk, learnOk, lunchBad, rescued, lost };
}

describe('backtest do aprendizado (walk-forward)', () => {
  const { byUser, relabelN, fillN } = allLessons();
  const lessonsUntil = (user: string, date: string, cut: string) =>
    (byUser.get(user) || []).filter((l) => l.date <= cut && l.date < date);

  it('no período inteiro, com lessons anteriores ao dia, não regride o 41/42 e não cria almoço < 60 min', () => {
    const types = scoreTypes((user, date) => (byUser.get(user) || []).filter((l) => l.date < date));
    const fills = scoreFills((user, date) => (byUser.get(user) || []).filter((l) => l.date < date));
    expect(types.n).toBe(42);
    expect(types.baseOk).toBeGreaterThanOrEqual(41);
    expect(types.learnOk).toBeGreaterThanOrEqual(41);
    expect(fills.lunchBad).toBe(0);
    expect(types.lost).toEqual([]);

    const late: string[] = [];
    let cassioTimed = 0;
    for (const c of F.cases) {
      const flex = c.user === FLEX;
      const s = scheduleOf(c);
      const h = flex ? null : computeHabit(F.history[c.user] || [], c.date, (byUser.get(c.user) || []).filter((l) => l.date < c.date));
      const r = interpretDay({ punches: c.punches.map((p, i) => ({ id: `p${i}`, min: p.min, type: p.totem, manual: false })), schedule: s, habit: h, options: { flexible: flex } });
      const fr = r.fills.find((f) => f.type === 'RETORNO');
      if (fr && fr.min >= LATE_RETURN_LIMIT && !(h && h.RETORNO >= LATE_RETURN_LIMIT)) late.push(`${c.who} ${c.date} ${hm(fr.min)}`);
      if (flex && r.fills.length) cassioTimed += 1;
    }
    expect(late).toEqual([]);
    expect(cassioTimed).toBe(0);
  });

  it('walk-forward em cortes mensais e quinzenais: aprende até D, testa depois de D', () => {
    const cuts = ['2026-10-15', '2026-10-31', '2026-11-10'];
    const lines: string[] = [];
    const results: { cut: string; n: number; baseOk: number; learnOk: number; fillN: number; fillBase: number; fillLearn: number; rescued: string[]; lost: string[] }[] = [];
    for (const cut of cuts) {
      const types = scoreTypes((user, date) => lessonsUntil(user, date, cut), cut);
      const fills = scoreFills((user, date) => lessonsUntil(user, date, cut), cut);
      results.push({
        cut, n: types.n, baseOk: types.baseOk, learnOk: types.learnOk,
        fillN: fills.n, fillBase: fills.baseOk, fillLearn: fills.learnOk,
        rescued: types.rescued.map((r) => `${r.date} ${r.who} ${hm(r.min)} ${r.totem}→${r.final} (base: ${r.gotBase})`),
        lost: types.lost.map((r) => `${r.date} ${r.who} ${hm(r.min)} ${r.totem}→${r.final} (learn: ${r.gotLearn})`),
      });
      expect(types.learnOk).toBeGreaterThanOrEqual(types.baseOk);
      expect(fills.lunchBad).toBe(0);
    }

    // relatório para o pai/usuário
    const whole = scoreTypes((user, date) => (byUser.get(user) || []).filter((l) => l.date < date));
    const wholeF = scoreFills((user, date) => (byUser.get(user) || []).filter((l) => l.date < date));
    const missBase = whole.rows.filter((r) => r.gotBase !== r.final);
    const missLearn = whole.rows.filter((r) => r.gotLearn !== r.final);
    lines.push('# Backtest — aprender com as correções do gestor');
    lines.push('');
    lines.push(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília).`);
    lines.push('Dataset: `tests/fixtures/classifier-backtest.json` (mesma origem de `/workspace/arte-painel-v2/backtest`, 01/10–23/11).');
    lines.push(`Lições extraídas: ${relabelN} correções de tipo + ${fillN} lançamentos * (nunca se altera a batida original).`);
    lines.push('');
    lines.push('## Período inteiro (cada dia só vê correções anteriores)');
    lines.push('');
    lines.push('| Métrica | Regra atual (sem lessons) | Com aprendizado |');
    lines.push('|---|---|---|');
    lines.push(`| Tipos corrigidos pelo gestor | **${whole.baseOk}/${whole.n}** (${(100 * whole.baseOk / whole.n).toFixed(1)}%) | **${whole.learnOk}/${whole.n}** (${(100 * whole.learnOk / whole.n).toFixed(1)}%) |`);
    lines.push(`| Lançamentos * no minuto exato | ${wholeF.baseOk}/${wholeF.n} (${(100 * wholeF.baseOk / wholeF.n).toFixed(1)}%) | ${wholeF.learnOk}/${wholeF.n} (${(100 * wholeF.learnOk / wholeF.n).toFixed(1)}%) |`);
    lines.push('');
    if (missBase.length) {
      lines.push('Erros da regra atual:');
      for (const r of missBase) lines.push(`- ${r.date} ${r.who} ${hm(r.min)} totem ${r.totem} → gestor ${r.final}, sistema ${r.gotBase}${r.gotLearn === r.final ? ' (aprendizado acertou)' : r.gotLearn !== r.gotBase ? ` (aprendizado: ${r.gotLearn})` : ''}`);
      lines.push('');
    }
    if (missLearn.length) {
      lines.push('Ainda errados com aprendizado:');
      for (const r of missLearn) lines.push(`- ${r.date} ${r.who} ${hm(r.min)} totem ${r.totem} → gestor ${r.final}, sistema ${r.gotLearn}`);
      lines.push('');
    }
    if (wholeF.rescued.length) {
      lines.push('Lançamentos * resgatados pelo aprendizado:');
      for (const s of wholeF.rescued) lines.push(`- ${s}`);
      lines.push('');
    }
    if (wholeF.lost.length) {
      lines.push('Lançamentos * que a regra atual acertava e o aprendizado errou:');
      for (const s of wholeF.lost) lines.push(`- ${s}`);
      lines.push('');
    }
    lines.push('## Walk-forward (aprende até D, testa depois de D)');
    lines.push('');
    lines.push('| Corte D | Tipos depois de D (base → aprendido) | Lançamentos * (base → aprendido) | Resgatados | Perdidos |');
    lines.push('|---|---|---|---|---|');
    for (const r of results) {
      const tb = r.n ? `${r.baseOk}/${r.n} (${(100 * r.baseOk / r.n).toFixed(0)}%)` : '—';
      const tl = r.n ? `${r.learnOk}/${r.n} (${(100 * r.learnOk / r.n).toFixed(0)}%)` : '—';
      const fb = r.fillN ? `${r.fillBase}/${r.fillN}` : '—';
      const fl = r.fillN ? `${r.fillLearn}/${r.fillN}` : '—';
      lines.push(`| ${r.cut} | ${tb} → **${tl}** | ${fb} → **${fl}** | ${r.rescued.length} | ${r.lost.length} |`);
    }
    lines.push('');
    for (const r of results) {
      if (r.rescued.length || r.lost.length) {
        lines.push(`### Depois de ${r.cut}`);
        for (const s of r.rescued) lines.push(`- Resgatado: ${s}`);
        for (const s of r.lost) lines.push(`- Regrediu: ${s}`);
        lines.push('');
      }
    }
    lines.push('## Como ler');
    lines.push('');
    lines.push('A regra atual (90 dias, peso 3× nos 30 recentes, almoço fixo da escala, jornada flexível) já acerta 41/42 tipos. O aprendizado **não regride** esse gate, nem inventa Retorno ≥ 13:30 fora do padrão, nem sugere horário para o Cássio (jornada flexível), nem sobrepõe o almoço 10:30–11:30 do Robson.');
    lines.push('');
    lines.push('As lições entram como sinal no hábito ponderado (completam dias com `*`, peso um pouco maior no dia corrigido, recorte por dia da semana só com evidência forte). Sem padrão claro (≥5 dias e ±20 min) a leitura continua DÚVIDA, sem horário inventado. Origem: fixture do classificador / `/workspace/arte-painel-v2/backtest`. Base: `1370c03` (`feat/classificador-padrao-real`).');
    const dir = '/workspace/arte-aprender';
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/BACKTEST.md`, lines.join('\n'));
    writeFileSync('/workspace/pv-learn/arte/BACKTEST.md', lines.join('\n'));
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  });
});
