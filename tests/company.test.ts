import { describe, expect, it } from 'vitest';
import { COMPANIES, ESCOLA_MEMBERS, companyCnpjLabel, matchesCompany, parseCompanyFilter, resolveCompany, selectBatchTargets } from '../lib/company';
import { buildTimesheetDocument } from '../lib/signed-timesheet-pdf';

describe('empresa', () => {
  it('padrão é Espaço Progredir quando não há coluna nem perfil', () => {
    expect(resolveCompany({})).toBe('ESPACO_PROGREDIR');
    expect(resolveCompany({ profileJson: '{bad json' })).toBe('ESPACO_PROGREDIR');
    expect(resolveCompany(null)).toBe('ESPACO_PROGREDIR');
  });
  it('lê profileJson.company e prioriza a coluna quando existir', () => {
    expect(resolveCompany({ profileJson: JSON.stringify({ company: 'ESPACO_EDUCACIONAL_PROGREDIR' }) })).toBe('ESPACO_EDUCACIONAL_PROGREDIR');
    expect(resolveCompany({ company: 'ESPACO_PROGREDIR', profile: { company: 'ESPACO_EDUCACIONAL_PROGREDIR' } })).toBe('ESPACO_PROGREDIR');
    expect(resolveCompany({ company: 'XYZ' })).toBe('ESPACO_PROGREDIR');
  });
  it('filtro', () => {
    expect(parseCompanyFilter('lixo')).toBe('ALL');
    expect(matchesCompany({}, 'ALL')).toBe(true);
    expect(matchesCompany({}, 'ESPACO_EDUCACIONAL_PROGREDIR')).toBe(false);
  });
  it('mesmo CNPJ nas duas empresas', () => {
    expect(COMPANIES.ESPACO_EDUCACIONAL_PROGREDIR.cnpj).toBe(COMPANIES.ESPACO_PROGREDIR.cnpj);
    expect(companyCnpjLabel('ESPACO_EDUCACIONAL_PROGREDIR')).toBe('CNPJ 05.553.848/0001-61');
  });
  it('lote: só quem é da empresa e tem marcação no dia, sem duplicar', () => {
    const esc = { profile: { company: 'ESPACO_EDUCACIONAL_PROGREDIR' } };
    const emps = [{ id: 'a', ...esc }, { id: 'b', ...esc }, { id: 'c', ...esc }, { id: 'd' }, { id: 'e', ...esc, active: false }];
    const r = selectBatchTargets(emps, 'ESPACO_EDUCACIONAL_PROGREDIR', new Set(['a', 'c', 'd', 'e']), new Set(['c']));
    expect(r.targets.map((x) => x.id)).toEqual(['a']);
    expect(r.withoutPunches.map((x) => x.id)).toEqual(['b']);
    expect(r.alreadyCovered.map((x) => x.id)).toEqual(['c']);
  });
  it('lista da escola tem 9 pessoas', () => expect(ESCOLA_MEMBERS).toHaveLength(9));
  it('PDF da escola sai com o nome da escola', async () => {
    const base = { name: 'Robson de Souza Santos', employeeNumber: '2201', cpf: null, jobTitle: 'Educador Social', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:30', scheduleEnd: '16:30' };
    const { pdfDoc } = await buildTimesheetDocument({ employee: { ...base, company: 'ESPACO_EDUCACIONAL_PROGREDIR' }, punches: [], month: '2026-10', options: { today: '2026-10-29' } });
    expect(pdfDoc.getAuthor()).toBe('Espaço Educacional Progredir');
    const { pdfDoc: d2 } = await buildTimesheetDocument({ employee: base, punches: [], month: '2026-10', options: { today: '2026-10-29' } });
    expect(d2.getAuthor()).toBe('Espaço Progredir');
  });
});
