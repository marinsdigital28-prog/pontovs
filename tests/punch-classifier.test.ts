import { describe, expect, it } from 'vitest';
import fixture from './fixtures/classifier-backtest.json';
import { classify, computeHabit, describeReading, hm, interpretDay, LATE_RETURN_LIMIT, MIN_LUNCH, proposeFill, toClassSchedule, type HistoryDay, type PType } from '../lib/punch-classifier';

type Case = { user: string; who: string; date: string; schedule: { start: string; end: string; mode: 'FULL' | 'HALF' }; corrected: boolean; punches: { min: number; totem: string; final: string; corrected: boolean }[] };
const F = fixture as unknown as { history: Record<string, HistoryDay[]>; cases: Case[]; fills: { user: string; date: string; schedule: Case['schedule']; present: Record<string, number>; type: PType; gestor: number }[]; alerts: { user: string; who: string; date: string; kind: string; oldTitle: string; schedule: Case['schedule']; punches: { min: number; type: string; manual: boolean }[] }[] };
const habitOf = (user: string, date: string) => computeHabit(F.history[user] || [], date);

describe('backtest (gate de CI) — batidas corrigidas por humanos', () => {
  const corrected = F.cases.flatMap((c) => {
    const r = classify(c.punches.map((p) => p.min), toClassSchedule(c.schedule)!, habitOf(c.user, c.date));
    return c.punches.map((p, i) => ({ c, p, got: r.labels[i] })).filter((x) => x.p.corrected);
  });
  const ok = corrected.filter((x) => x.got === x.p.final).length;
  it(`acerta ≥95% das ${corrected.length} batidas corrigidas (lógica antiga: ${corrected.filter((x) => x.p.totem === x.p.final).length})`, () => {
    expect(corrected.length).toBe(42);
    expect(ok / corrected.length).toBeGreaterThanOrEqual(0.95);
  });
  it('concorda com ≥97% das batidas que ninguém precisou corrigir', () => {
    let n = 0; let agree = 0;
    for (const c of F.cases) {
      const r = classify(c.punches.map((p) => p.min), toClassSchedule(c.schedule)!, habitOf(c.user, c.date));
      c.punches.forEach((p, i) => { if (!p.corrected) { n += 1; agree += Number(r.labels[i] === p.final); } });
    }
    expect(agree / n).toBeGreaterThanOrEqual(0.97);
  });
});

describe('preenchimento (gate de CI): almoço ≥60 min e sem Retorno ≥13:30 fora do hábito', () => {
  it('em todos os dias do período, nenhum preenchimento cria almoço < 60 min ou Retorno tardio sem hábito', () => {
    const bad: string[] = [];
    for (const c of F.cases) {
      const s = toClassSchedule(c.schedule)!;
      const h = habitOf(c.user, c.date);
      const lab: Partial<Record<PType, number>> = {};
      c.punches.forEach((p) => { if (lab[p.final as PType] === undefined) lab[p.final as PType] = p.min; });
      const { fills, doubt } = proposeFill(lab, s, h);
      if (doubt) continue; // dúvida vai para o gestor, nunca é lançada
      const all = { ...lab, ...Object.fromEntries(fills.map((f) => [f.type, f.min])) };
      const filledLunch = fills.some((f) => f.type === 'INTERVALO' || f.type === 'RETORNO');
      if (filledLunch && all.INTERVALO !== undefined && all.RETORNO !== undefined && all.RETORNO - all.INTERVALO < MIN_LUNCH - 5) bad.push(`${c.who} ${c.date} almoço ${hm(all.INTERVALO)}–${hm(all.RETORNO)}`);
      const fr = fills.find((f) => f.type === 'RETORNO');
      const habitualReturn = h ? h.RETORNO : 780;
      if (fr && fr.min >= LATE_RETURN_LIMIT && habitualReturn < LATE_RETURN_LIMIT) bad.push(`${c.who} ${c.date} Retorno ${hm(fr.min)}`);
    }
    expect(bad).toEqual([]);
  });
  it('lançamentos do gestor: novo acerta ≥70% no minuto exato e erra almoço < 60', () => {
    let ok = 0;
    for (const f of F.fills) {
      const r = proposeFill(f.present as Partial<Record<PType, number>>, toClassSchedule(f.schedule)!, habitOf(f.user, f.date));
      ok += Number(r.fills.find((x) => x.type === f.type)?.min === f.gestor);
    }
    expect(ok / F.fills.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe('os alertas reais de novembro (14:00/14:30) são substituídos', () => {
  for (const a of F.alerts) {
    it(`${a.date} ${a.who}: antes "${a.oldTitle}"`, () => {
      const reading = interpretDay({
        punches: a.punches.filter((p) => p.min >= 300).map((p, i) => ({ id: `p${i}`, min: p.min, type: p.type, manual: p.manual })),
        schedule: toClassSchedule(a.schedule)!,
        habit: habitOf(a.user, a.date),
      });
      const text = describeReading(reading);
      // nunca mais Retorno 14:00/14:30
      expect(reading.fills.some((f) => f.type === 'RETORNO' && f.min >= LATE_RETURN_LIMIT)).toBe(false);
      console.log(`${a.date} ${a.who} | antes: ${a.oldTitle} | agora: ${text || '(nada)'} | ${Math.round(reading.confidence * 100)}% ${reading.level} | dia: ${reading.resultingDay}`);
    });
  }

  it('casos-chave', () => {
    const get = (who: string, date: string) => {
      const a = F.alerts.find((x) => x.who === who && x.date === date)!;
      return interpretDay({ punches: a.punches.filter((p) => p.min >= 300).map((p, i) => ({ id: `p${i}`, min: p.min, type: p.type, manual: p.manual })), schedule: toClassSchedule(a.schedule)!, habit: habitOf(a.user, a.date) });
    };
    const eli = get('EGS', '2026-11-23');
    expect(eli.relabels.map((r) => `${hm(r.min)}>${r.to}`)).toEqual(['11:59>INTERVALO', '13:06>RETORNO']);
    expect(eli.fills).toEqual([{ type: 'ENTRADA', min: 7 * 60 }]);
    expect(eli.level).toBe('ALTA');
    const ana = get('AMDS', '2026-11-19');
    expect(ana.relabels.map((r) => r.to)).toEqual(['INTERVALO', 'RETORNO']);
    expect(ana.fills.map((f) => f.type)).toEqual(['ENTRADA']);
    const mai = get('MFM', '2026-11-23');
    expect(mai.fills.every((f) => f.min < LATE_RETURN_LIMIT)).toBe(true);
    expect(mai.level).not.toBe('ALTA');
  });
});

describe('regras unitárias', () => {
  const s = { start: 480, end: 1020, mode: 'FULL' as const };
  it('batida do almoço sem Entrada vira Intervalo, não Entrada', () => {
    expect(classify([720, 781, 1022], s, null).labels).toEqual(['INTERVALO', 'RETORNO', 'SAIDA']);
  });
  const regular = computeHabit(Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, punches: [{ type: 'ENTRADA', min: 478 + (i % 5) }, { type: 'INTERVALO', min: 719 + (i % 4) }, { type: 'RETORNO', min: 779 + (i % 4) }, { type: 'SAIDA', min: 1020 + (i % 3) }] })), '2026-10-30');
  it('Retorno faltando usa o padrão real redondo, nunca +60 cego', () => {
    expect(proposeFill({ ENTRADA: 480, INTERVALO: 722, SAIDA: 1020 }, s, regular).fills).toEqual([{ type: 'RETORNO', min: 780 }]);
  });
  it('Intervalo esquecido com Retorno 13:01 → 12:00 (padrão real)', () => {
    expect(proposeFill({ ENTRADA: 480, RETORNO: 781, SAIDA: 1020 }, s, regular).fills).toEqual([{ type: 'INTERVALO', min: 720 }]);
  });
  it('sem padrão real (sem histórico) → não inventa almoço: falta sem horário + dúvida', () => {
    const r = proposeFill({ ENTRADA: 480, RETORNO: 781, SAIDA: 1020 }, s, null);
    expect(r.fills).toEqual([]);
    expect(r.missing).toEqual(['INTERVALO']);
    expect(r.doubt).toMatch(/Sem padrão claro/);
  });
  it('meio expediente: 2 batidas = Entrada/Saída', () => {
    expect(classify([452, 692], { start: 450, end: 690, mode: 'HALF' }, null).labels).toEqual(['ENTRADA', 'SAIDA']);
  });
});
