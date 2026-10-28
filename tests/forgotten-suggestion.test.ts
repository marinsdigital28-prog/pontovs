import { describe, expect, it } from 'vitest';
import { isChronological, overallConfidence, parseInformedTime, suggestMissingTime } from '../lib/forgotten-suggestion';

const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const schedule = { start: '08:00', end: '17:00', mode: 'FULL' as const };

describe('sugestão de batida esquecida', () => {
  it('prioriza o horário informado pelo colaborador', () => {
    const s = suggestMissingTime({ type: 'SAIDA', date: '2026-10-20', informedTime: '17:40', history: [], schedule });
    expect(s).toMatchObject({ time: '17:40', confidence: 'ALTA', source: 'COLABORADOR' });
  });

  it('usa a mediana dos últimos dias com confiança alta quando o padrão é estável', () => {
    const history = ['01', '02', '05', '06', '07', '08'].map((d, i) => ({ type: 'SAIDA', timestamp: at(`2026-10-${d}`, `17:0${i}`) }));
    const s = suggestMissingTime({ type: 'SAIDA', date: '2026-10-20', history, schedule });
    expect(s?.source).toBe('HISTORICO');
    expect(s?.confidence).toBe('ALTA');
    expect(s?.time).toBe('17:03');
  });

  it('baixa para média quando o histórico varia muito', () => {
    const times = ['16:00', '17:30', '18:40', '16:20', '19:00'];
    const history = times.map((t, i) => ({ type: 'SAIDA', timestamp: at(`2026-10-0${i + 1}`, t) }));
    expect(suggestMissingTime({ type: 'SAIDA', date: '2026-10-20', history, schedule })?.confidence).toBe('MEDIA');
  });

  it('ignora o próprio dia e dias futuros no histórico', () => {
    const history = [at('2026-10-20', '10:00'), at('2026-10-21', '10:00'), at('2026-10-22', '10:00')].map((timestamp) => ({ type: 'ENTRADA', timestamp }));
    expect(suggestMissingTime({ type: 'ENTRADA', date: '2026-10-20', history, schedule })?.source).toBe('JORNADA');
  });

  it('cai para a jornada e depois para a regra do almoço', () => {
    expect(suggestMissingTime({ type: 'ENTRADA', date: '2026-10-20', history: [], schedule })).toMatchObject({ time: '08:00', confidence: 'MEDIA', source: 'JORNADA' });
    expect(suggestMissingTime({ type: 'RETORNO', date: '2026-10-20', history: [], schedule })).toMatchObject({ time: '13:00', confidence: 'BAIXA', source: 'REGRA_ALMOCO' });
    expect(suggestMissingTime({ type: 'SAIDA', date: '2026-10-20', history: [], schedule: null })).toBeNull();
  });

  it('lê o horário aproximado dos detalhes do pedido', () => {
    expect(parseInformedTime('Batida esquecida: Saída · Horário aproximado: 17:05 · Aviso')).toBe('17:05');
    expect(parseInformedTime('Modo honestidade (~7:58)')).toBe('07:58');
    expect(parseInformedTime('sem hora')).toBeNull();
  });

  it('calcula confiança geral e ordem cronológica', () => {
    expect(overallConfidence([{ time: '1', confidence: 'ALTA', source: 'HISTORICO', detail: '' }])).toBe('ALTA');
    expect(overallConfidence([{ time: '1', confidence: 'ALTA', source: 'HISTORICO', detail: '' }, null])).toBe('BAIXA');
    expect(isChronological([{ type: 'ENTRADA', minutes: 480 }, { type: 'SAIDA', minutes: 1020 }])).toBe(true);
    expect(isChronological([{ type: 'ENTRADA', minutes: 600 }, { type: 'SAIDA', minutes: 500 }])).toBe(false);
  });
});
