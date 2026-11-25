import { describe, expect, it } from 'vitest';
import fixture from './fixtures/classifier-backtest.json';
import { classify, computeHabit, hm, interpretDay, LATE_RETURN_LIMIT, proposeFill, toClassSchedule, type HistoryDay, type PType } from '../lib/punch-classifier';
import { evaluateDay } from '../lib/auto-close';
import { classifierProfile } from '../lib/employee-rules';
import { parseScheduleByDay, scheduleSummary } from '../lib/day-schedule';

const F = fixture as unknown as { history: Record<string, HistoryDay[]>; cases: any[]; fills: any[] };
// No fixture anonimizado: U04 = vice-diretor com jornada flexível (CFO); U28 = educador com almoço fixo 10:30–11:30 (RSS).
const FLEX = 'U04';
const ROB = 'U28';
const robSchedule = toClassSchedule({ start: '07:30', end: '16:30', mode: 'FULL', lunchStart: '10:30', lunchEnd: '11:30' })!;
const cassioSchedule = toClassSchedule({ start: '07:30', end: '16:30', mode: 'FULL' })!;
const dayOf = (u: string, date: string) => F.history[u].find((d) => d.date === date)!;
const drop = (u: string, date: string, t: PType) => dayOf(u, date).punches.filter((p) => p.type !== t).map((p, i) => ({ id: `x${i}`, min: p.min, type: p.type, manual: false }));

describe('padrão real (90 dias, peso nos 30 recentes)', () => {
  it('usa até 90 dias e pesa mais os 30 recentes', () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, punches: [{ type: 'ENTRADA', min: 420 }, { type: 'INTERVALO', min: 660 }, { type: 'RETORNO', min: 720 }, { type: 'SAIDA', min: 960 }] }));
    const recent = Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(i + 10).padStart(2, '0')}`, punches: [{ type: 'ENTRADA', min: 480 }, { type: 'INTERVALO', min: 720 }, { type: 'RETORNO', min: 780 }, { type: 'SAIDA', min: 1020 }] }));
    const h = computeHabit([...old, ...recent], '2026-10-25')!;
    expect(h.n).toBe(42);
    expect(h.nRecent).toBe(12);
    // 12 dias recentes × 3 = 36 > 30 antigos → o padrão recente vence
    expect(h.INTERVALO).toBe(720);
    // mais de 90 dias atrás não conta
    expect(computeHabit(old, '2026-12-15')).toBeNull();
  });
  it('dispersão alta → padrão não é claro → sem horário de almoço inventado (dúvida)', () => {
    const messy = Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, punches: [{ type: 'ENTRADA', min: 480 }, { type: 'INTERVALO', min: 690 + (i % 5) * 25 }, { type: 'RETORNO', min: 750 + (i % 5) * 25 }, { type: 'SAIDA', min: 1020 }] }));
    const h = computeHabit(messy, '2026-10-20')!;
    expect(h.clear.INTERVALO).toBe(false);
    const r = proposeFill({ ENTRADA: 480, INTERVALO: 735, SAIDA: 1020 }, toClassSchedule({ start: '08:00', end: '17:00', mode: 'FULL' })!, h);
    expect(r.fills).toEqual([]);
    expect(r.missing).toEqual(['RETORNO']);
    expect(r.doubt).toMatch(/sem padrão claro de almoço/);
  });
  it('Entrada/Saída: padrão real claro e diferente da escala → usa o padrão real', () => {
    const early = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, punches: [{ type: 'ENTRADA', min: 450 + (i % 3) }, { type: 'INTERVALO', min: 720 }, { type: 'RETORNO', min: 780 }, { type: 'SAIDA', min: 1020 }] }));
    const r = proposeFill({ INTERVALO: 720, RETORNO: 780, SAIDA: 1020 }, toClassSchedule({ start: '08:00', end: '17:00', mode: 'FULL' })!, computeHabit(early, '2026-10-20'));
    expect(r.fills).toEqual([{ type: 'ENTRADA', min: 450 }]);
    expect(r.doubt).toBeNull();
  });
});

describe('Cássio (jornada flexível): nunca força padrão', () => {
  it('perfil lido do cadastro', () => {
    expect(classifierProfile(JSON.stringify({ jornadaFlexivel: true, phone: 'x' })).flexible).toBe(true);
    expect(classifierProfile(null).flexible).toBe(false);
    expect(classifierProfile('{bad').flexible).toBe(false);
  });
  it('em dias reais com batida faltando: sempre DÚVIDA e nenhum horário inventado', () => {
    for (const date of ['2026-11-13', '2026-11-16', '2026-11-23']) {
      for (const t of ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as PType[]) {
        const r = interpretDay({ punches: drop(FLEX, date, t), schedule: cassioSchedule, habit: computeHabit(F.history[FLEX], date), options: { flexible: true } });
        expect(r.level).toBe('DUVIDA');
        expect(r.fills).toEqual([]);
        expect(r.missing.length).toBeGreaterThan(0);
      }
    }
  });
  it('dia completo dele não gera pendência', () => {
    const r = interpretDay({ punches: dayOf(FLEX, '2026-11-13').punches.map((p, i) => ({ id: `c${i}`, min: p.min, type: p.type, manual: false })), schedule: cassioSchedule, habit: null, options: { flexible: true } });
    expect(r.relabels).toEqual([]);
    expect(r.fills).toEqual([]);
    expect(r.missing).toEqual([]);
  });
  it('verificação 17:20: nunca AUTO, pendência DÚVIDA sem horário', () => {
    const emp = { id: 'c', name: 'Vice', employeeNumber: '0506', workDays: 'TER,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '16:30', scheduleByDay: null, profileJson: JSON.stringify({ jornadaFlexivel: true }) };
    const at = (hhmm: string, type: string) => ({ id: `${type}${hhmm}`, type, timestamp: new Date(`2026-11-13T${hhmm}:00-03:00`), status: 'VALID', origin: 'ONLINE', hasPhoto: true, clientId: null });
    const history = F.history[FLEX].filter((d) => d.date < '2026-11-13');
    const d = evaluateDay({ employee: emp, date: '2026-11-13', punches: [at('07:26', 'ENTRADA'), at('13:38', 'INTERVALO'), at('14:37', 'RETORNO')], history });
    expect(d.outcome).toBe('PENDENCIA');
    expect(d.pendencia?.kind).toBe('DUVIDA');
    expect(d.pendencia?.suggestion?.kind).toBe('TEXT');
    expect(d.pendencia?.title).not.toMatch(/\d\d:\d\d\*/);
  });
});

describe('Robson: almoço fixo 10:30–11:30 na escala', () => {
  it('escala por dia guarda e mostra o almoço', () => {
    const by = JSON.stringify(Object.fromEntries(['SEG', 'TER', 'QUA', 'QUI', 'SEX'].map((d) => [d, { start: '07:30', end: '16:30', mode: 'FULL', lunchStart: '10:30', lunchEnd: '11:30' }])));
    expect(parseScheduleByDay(by).SEG).toEqual({ start: '07:30', end: '16:30', mode: 'FULL', lunchStart: '10:30', lunchEnd: '11:30' });
    expect(scheduleSummary({ scheduleByDay: by, workDays: 'SEG,TER,QUA,QUI,SEX' })).toBe('SEG–SEX 07:30–16:30 (almoço 10:30–11:30)');
  });
  it('lançamentos reais do gestor (Retorno 11:30) são reproduzidos', () => {
    for (const f of F.fills.filter((x) => x.user === ROB && x.type === 'RETORNO')) {
      expect(proposeFill(f.present, robSchedule, computeHabit(F.history[ROB], f.date)).fills.find((x) => x.type === 'RETORNO')?.min).toBe(f.gestor);
    }
  });
  it('mesmo sem histórico, o almoço configurado é usado (nunca 12:00/13:00)', () => {
    const r = proposeFill({ ENTRADA: 450, SAIDA: 990 }, robSchedule, null);
    expect(r.fills.filter((x) => x.type === 'INTERVALO' || x.type === 'RETORNO').map((x) => hm(x.min))).toEqual(['10:30', '11:30']);
  });
  it('batida das 10:31 sem Entrada é Intervalo (não Entrada)', () => {
    expect(classify([631, 691, 990], robSchedule, null).labels).toEqual(['INTERVALO', 'RETORNO', 'SAIDA']);
  });
});

describe('gate: nenhuma sugestão ≥ 13:30 fora do padrão real (todos os dias do período)', () => {
  it('0 retornos tardios sugeridos', () => {
    const bad: string[] = [];
    for (const c of F.cases) {
      const flex = c.user === FLEX;
      const s = c.user === ROB ? robSchedule : toClassSchedule(c.schedule)!;
      const h = computeHabit(F.history[c.user] || [], c.date);
      const r = interpretDay({ punches: c.punches.map((p: any, i: number) => ({ id: `p${i}`, min: p.min, type: p.totem, manual: false })), schedule: s, habit: h, options: { flexible: flex } });
      const fr = r.fills.find((f) => f.type === 'RETORNO');
      if (fr && fr.min >= LATE_RETURN_LIMIT && !(h && h.RETORNO >= LATE_RETURN_LIMIT)) bad.push(`${c.who} ${c.date} ${hm(fr.min)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('lições do gestor não furam as regras novas', () => {
  it('Cássio (flexível) continua sem horário mesmo com várias correções * anteriores', () => {
    const lessons = [
      { date: '2026-11-06', type: 'SAIDA' as const, min: 990, kind: 'FILL' as const, source: 'GESTOR' as const },
      { date: '2026-11-09', type: 'SAIDA' as const, min: 996, kind: 'FILL' as const, source: 'GESTOR' as const },
    ];
    const h = computeHabit(F.history[FLEX], '2026-11-13', lessons);
    const r = interpretDay({ punches: drop(FLEX, '2026-11-13', 'SAIDA'), schedule: cassioSchedule, habit: h, options: { flexible: true } });
    expect(r.level).toBe('DUVIDA');
    expect(r.fills).toEqual([]);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.learnedNote).toBeNull();
  });

  it('almoço fixo do Robson (10:30–11:30) vence lições de 12:00/13:00', () => {
    const lessons = [
      { date: '2026-10-15', type: 'INTERVALO' as const, min: 720, kind: 'FILL' as const, source: 'GESTOR' as const },
      { date: '2026-10-15', type: 'RETORNO' as const, min: 780, kind: 'FILL' as const, source: 'GESTOR' as const },
      { date: '2026-11-03', type: 'INTERVALO' as const, min: 720, kind: 'FILL' as const, source: 'GESTOR' as const },
      { date: '2026-11-03', type: 'RETORNO' as const, min: 780, kind: 'FILL' as const, source: 'GESTOR' as const },
    ];
    const h = computeHabit(F.history[ROB], '2026-11-17', lessons);
    const r = proposeFill({ ENTRADA: 450, SAIDA: 990 }, robSchedule, h);
    expect(r.fills.filter((x) => x.type === 'INTERVALO' || x.type === 'RETORNO').map((x) => hm(x.min))).toEqual(['10:30', '11:30']);
  });
});
