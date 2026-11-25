import { describe, expect, it } from 'vitest';
import { computeHabit, interpretDay, type HistoryDay, type PType } from '../lib/punch-classifier';
import { describeLearning, lessonsFromCorrections, recencyWeight, weekdayOf, weightedMedian, type Lesson } from '../lib/habit-learn';

const full = (date: string, e = 420, i = 720, r = 780, s = 960): HistoryDay => ({
  date,
  punches: [
    { type: 'ENTRADA', min: e },
    { type: 'INTERVALO', min: i },
    { type: 'RETORNO', min: r },
    { type: 'SAIDA', min: s },
  ],
});

/** Só 2 dias completos — de propósito abaixo do mínimo de 4, para o hábito só existir com as lessons. */
const thin: HistoryDay[] = [full('2026-10-01'), full('2026-10-02')];

const eliLessons: Lesson[] = lessonsFromCorrections({
  relabels: [
    { date: '2026-10-05', type: 'INTERVALO', min: 720, fromType: 'ENTRADA' },
    { date: '2026-10-05', type: 'RETORNO', min: 781, fromType: 'INTERVALO' },
    { date: '2026-10-08', type: 'INTERVALO', min: 719, fromType: 'ENTRADA' },
    { date: '2026-10-08', type: 'RETORNO', min: 782, fromType: 'INTERVALO' },
  ],
  fills: [
    { date: '2026-10-05', type: 'ENTRADA', min: 420 },
    { date: '2026-10-08', type: 'ENTRADA', min: 420 },
  ],
});

describe('funções auxiliares', () => {
  it('peso da correção recente é maior que o de uma antiga', () => {
    expect(recencyWeight('2026-11-16', '2026-11-23')).toBeGreaterThan(recencyWeight('2026-09-01', '2026-11-23'));
    expect(recencyWeight('2026-11-20', '2026-11-23')).toBe(4);
  });
  it('mediana ponderada puxa para o valor de maior peso', () => {
    expect(weightedMedian([{ value: 780, weight: 1 }, { value: 780, weight: 1 }, { value: 840, weight: 4 }])).toBe(840);
  });
  it('weekdayOf usa o calendário de Brasília (não UTC)', () => {
    expect(weekdayOf('2026-10-05')).toBe(1); // segunda
    expect(weekdayOf('2026-11-23')).toBe(1);
  });
  it('describeLearning monta o texto do card', () => {
    expect(describeLearning([{ date: '2026-10-05', type: 'ENTRADA', kind: 'FILL' }])).toBe('Aprendido com sua correção de 05/10');
    expect(describeLearning([
      { date: '2026-10-08', type: 'ENTRADA', kind: 'FILL' },
      { date: '2026-10-05', type: 'ENTRADA', kind: 'FILL' },
    ])).toBe('Aprendido com suas correções de 08/10 e 05/10');
  });
});

describe('hábito com correções do gestor', () => {
  it('sem lessons e com menos de 4 dias completos, não inventa hábito', () => {
    expect(computeHabit(thin, '2026-10-23')).toBeNull();
  });

  it('com 2 correções * de Entrada 07:00, o hábito passa a existir e usa 07:00', () => {
    const h = computeHabit(thin, '2026-10-23', eliLessons);
    expect(h).not.toBeNull();
    expect(h!.ENTRADA).toBe(420);
    expect(h!.INTERVALO).toBeGreaterThanOrEqual(719);
    expect(h!.INTERVALO).toBeLessThanOrEqual(721);
    expect(h!.learnedFrom?.length).toBeGreaterThan(0);
    expect(describeLearning(h!.learnedFrom)).toMatch(/correç/);
  });

  it('a correção recente pesa mais que uma antiga no mesmo tipo', () => {
    const history = [full('2026-09-01', 420, 720, 780, 960), full('2026-09-02'), full('2026-09-03'), full('2026-09-04')];
    const lessons: Lesson[] = [
      { date: '2026-09-10', type: 'INTERVALO', min: 660, kind: 'RELABEL' }, // 11:00, antiga
      { date: '2026-10-20', type: 'INTERVALO', min: 720, kind: 'RELABEL' }, // 12:00, recente
    ];
    const h = computeHabit(history, '2026-10-23', lessons)!;
    const baseline = computeHabit(history, '2026-10-23')!;
    expect(Math.abs(h.INTERVALO - 720)).toBeLessThan(Math.abs(baseline.INTERVALO - 720) + 1);
    expect(h.INTERVALO).toBeGreaterThan(680);
  });

  it('mesmo dia da semana: saídas de sexta ~16:20 pesam no hábito de uma sexta', () => {
    // seg–qui saem às 17:00 (muitos dias); sextas corrigidas pelo gestor para 16:20
    const history: HistoryDay[] = [];
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
      history.push(full(d, 480, 720, 780, 1020)); // 17:00
    }
    const lessons: Lesson[] = [
      { date: '2026-10-02', type: 'SAIDA', min: 980, kind: 'FILL' }, // sexta 16:20
      { date: '2026-10-09', type: 'SAIDA', min: 980, kind: 'FILL' },
      { date: '2026-10-16', type: 'SAIDA', min: 985, kind: 'FILL' },
    ];
    const friday = computeHabit(history, '2026-10-23', lessons)!; // 23/10 é sexta
    const thursday = computeHabit(history, '2026-10-22', lessons)!; // quinta
    expect(friday.SAIDA).toBeLessThan(thursday.SAIDA);
    expect(friday.SAIDA).toBeLessThan(1005);
  });

  it('um único * de almoço atrasado numa sexta não puxa a próxima sexta para 14:12', () => {
    const history: HistoryDay[] = [
      full('2026-09-25', 508, 721, 786, 1021),
      full('2026-10-02', 494, 721, 786, 1024),
      full('2026-10-05', 512, 752, 786, 1022),
      full('2026-10-16', 522, 734, 784, 1037),
      full('2026-10-19', 502, 727, 780, 1025),
    ];
    const lessons: Lesson[] = [
      { date: '2026-10-09', type: 'RETORNO', min: 852, kind: 'FILL' },
    ];
    const incomplete: HistoryDay[] = [...history, { date: '2026-10-09', punches: [
      { type: 'ENTRADA', min: 505 }, { type: 'INTERVALO', min: 792 }, { type: 'SAIDA', min: 1028 },
    ] }];
    const h = computeHabit(incomplete, '2026-10-23', lessons)!;
    expect(h.INTERVALO).toBeLessThan(740);
    expect(h.RETORNO).toBeLessThan(810);
  });
});

describe('leitura do dia usa o que foi aprendido (originais intactos)', () => {
  it('depois das correções da Elisabete, 23/11 (12:00, 13:06, 16:05) vira Intervalo/Retorno/Saída + Entrada 07:00*', () => {
    const h = computeHabit(thin, '2026-11-23', eliLessons)!;
    const reading = interpretDay({
      punches: [
        { id: 'a', min: 719, type: 'ENTRADA', manual: false },
        { id: 'b', min: 786, type: 'INTERVALO', manual: false },
        { id: 'c', min: 965, type: 'SAIDA', manual: false },
      ],
      schedule: { start: 420, end: 960, mode: 'FULL' },
      habit: h,
    });
    expect(reading.relabels.map((r) => r.to)).toEqual(['INTERVALO', 'RETORNO']);
    expect(reading.fills).toEqual([{ type: 'ENTRADA', min: 420 }]);
    expect(reading.learnedNote).toMatch(/Aprendido com sua/);
    // as batidas recebidas não são mutadas
    expect(reading.labels.a).toBe('INTERVALO');
  });

  it('sem lessons o mesmo histórico fino não gera essa leitura automática (hábito nulo)', () => {
    expect(computeHabit(thin, '2026-11-23')).toBeNull();
  });
});

describe('Portaria 671: lessons são dados à parte', () => {
  it('lessonsFromCorrections não altera o histórico original', () => {
    const original: HistoryDay[] = [full('2026-10-01')];
    const copy = JSON.parse(JSON.stringify(original));
    computeHabit(original, '2026-10-23', eliLessons);
    expect(original).toEqual(copy);
  });
});
