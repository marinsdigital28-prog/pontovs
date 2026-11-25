import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capJob, expectedMinutes, fmtH, isLate14Suggestion, kpiCounts, kpiGroups, pendenciaCounts, workedMinutes, type KpiPerson } from '../lib/hoje-kpis';
import { buildClosing, remainingBusinessDays, type ClosingEmp } from '../lib/hoje-fechamento';
import { shortName } from '../lib/short-name';

const root = process.cwd();
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const hoje = readFileSync(resolve(root, 'app/admin/hoje-v2.tsx'), 'utf8');
const drawers = readFileSync(resolve(root, 'app/admin/hoje-drawers.tsx'), 'utf8');
const hojeRoute = readFileSync(resolve(root, 'app/api/admin/hoje/route.ts'), 'utf8');
const fechamentoRoute = readFileSync(resolve(root, 'app/api/admin/hoje/fechamento/route.ts'), 'utf8');
const atestado = readFileSync(resolve(root, 'app/admin/atestado-rapido.tsx'), 'utf8');
const kpisSrc = readFileSync(resolve(root, 'lib/hoje-kpis.ts'), 'utf8');

function person(partial: Partial<KpiPerson> & { id: string; name: string }): KpiPerson {
  return { scheduled: true, schedule: { start: '08:00', end: '17:00', mode: 'FULL' }, punches: [], lastType: null, absence: null, ...partial };
}

describe('cards clicáveis — números do card = números da gaveta', () => {
  it('kpiGroups e kpiCounts usam as mesmas regras do painel Hoje', () => {
    // As mesmas expressões de hoje-v2.tsx (via kpiGroups) — card e gaveta compartilham a função.
    expect(hoje).toContain('kpiGroups(people, data.nowMin)');
    expect(drawers).toContain('groups.working.length');
    expect(drawers).toContain('groups.left.length');
    expect(drawers).toContain('groups.noRecord.length');
    expect(drawers).toContain('pendenciaCounts');
    expect(kpisSrc).toContain("p.lastType && p.lastType !== 'SAIDA'");
    expect(kpisSrc).toContain("p.lastType === 'SAIDA'");
  });

  it('16 trabalhando + 8 saíram + 1 sem registro = 25 de hoje', () => {
    const people: KpiPerson[] = [];
    for (let i = 0; i < 16; i++) people.push(person({ id: `w${i}`, name: `W${i}`, lastType: 'RETORNO', punches: [{ type: 'ENTRADA', time: '08:00', rejected: false }, { type: 'RETORNO', time: '13:00', rejected: false }] }));
    for (let i = 0; i < 4; i++) people.push(person({ id: `h${i}`, name: `H${i}`, lastType: 'SAIDA', schedule: { start: '07:30', end: '11:30', mode: 'HALF' }, punches: [{ type: 'ENTRADA', time: '07:30', rejected: false }, { type: 'SAIDA', time: '11:30', rejected: false }] }));
    for (let i = 0; i < 4; i++) people.push(person({ id: `f${i}`, name: `F${i}`, lastType: 'SAIDA', punches: [{ type: 'ENTRADA', time: '08:00', rejected: false }, { type: 'SAIDA', time: '17:00', rejected: false }] }));
    people.push(person({ id: 'nr', name: 'Maria Reviane', lastType: null, punches: [] }));
    // folga (não entra no denominador)
    people.push(person({ id: 'off', name: 'Folga', scheduled: false, schedule: null, lastType: null, punches: [] }));

    const nowMin = 16 * 60 + 47;
    const c = kpiCounts(people, nowMin);
    expect(c).toEqual({ working: 16, today: 25, inLunch: 0, left: 8, leftHalf: 4, leftAbs: 0, noRecord: 1 });
    const g = kpiGroups(people, nowMin);
    expect(g.working.length).toBe(c.working);
    expect(g.left.length).toBe(c.left);
    expect(g.leftHalf.length).toBe(c.leftHalf);
    expect(g.noRecord.map((p) => p.name)).toEqual(['Maria Reviane']);
    expect(c.working + c.left + c.noRecord).toBe(c.today);
  });

  it('horas do dia ignoram DESCONSIDERADA e batida rejeitada', () => {
    const punches = [
      { type: 'ENTRADA', time: '08:11', rejected: false },
      { type: 'DESCONSIDERADA', time: '08:12', rejected: false },
      { type: 'INTERVALO', time: '12:04', rejected: false },
      { type: 'RETORNO', time: '13:04', rejected: false },
      { type: 'SAIDA', time: '00:00', rejected: true },
    ];
    // até 16:47: (12:04-08:11) + (16:47-13:04) = 233 + 223 = 456 min = 7h36
    expect(fmtH(workedMinutes(punches, 16 * 60 + 47))).toBe('7h36');
    expect(expectedMinutes({ start: '08:00', end: '17:00', mode: 'FULL' })).toBe(8 * 60);
    expect(expectedMinutes({ start: '07:30', end: '11:30', mode: 'HALF' })).toBe(4 * 60);
  });

  it('pendência: 0 alta · 0 média · 9 para conferir', () => {
    const p = Array.from({ length: 9 }, (_, i) => ({ level: 'CONFERIR' as const, id: String(i) }));
    expect(pendenciaCounts(p)).toEqual({ alta: 0, media: 0, conferir: 9, openCount: 9 });
  });
});

describe('fechamento do mês', () => {
  const cassio: ClosingEmp = { id: 'c', name: 'Cássio Freire', employeeNumber: '0506', workDays: 'TER,QUI,SEX', scheduleStart: '07:00', scheduleEnd: '16:00', scheduleByDay: null, profileJson: JSON.stringify({ jornadaFlexivel: true }) };
  const comum: ClosingEmp = { id: 'a', name: 'Ana', employeeNumber: '0001', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00', scheduleByDay: null };

  it('dias úteis de 25/11 até 30/11 são 4 (sem descontar feriado — igual ao card)', () => {
    expect(remainingBusinessDays('2026-11-25', '2026-11-30')).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30']);
  });

  it('feriado nacional não conta como falta', () => {
    const r = buildClosing({
      employees: [comum],
      punches: [],
      requests: [],
      certificates: [],
      today: '2026-11-25',
      month: '2026-11',
      openPendencias: [],
    });
    expect(r.people[0].faltas).not.toContain('2026-11-02');
    expect(r.people[0].faltas).not.toContain('2026-11-20');
  });

  it('troca de dia (Cássio) não conta como falta', () => {
    // 16/11 (seg, fora da grade) compensou 19/11 (qui, grade). 20/11 feriado.
    const punches = ['2026-11-03', '2026-11-05', '2026-11-06', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-23'].flatMap((d) => [
      { userId: 'c', date: d, type: 'ENTRADA', rejected: false },
      { userId: 'c', date: d, type: 'SAIDA', rejected: false },
    ]);
    const r = buildClosing({ employees: [cassio], punches, requests: [], certificates: [], today: '2026-11-25', month: '2026-11', openPendencias: [] });
    expect(r.people[0].faltas).toEqual([]);
    expect(r.people[0].trocas).toEqual(expect.arrayContaining(['2026-11-19', '2026-11-24']));
    expect(r.people[0].ok).toBe(true);
  });

  it('hoje não entra como dia incompleto', () => {
    const r = buildClosing({
      employees: [comum],
      punches: [{ userId: 'a', date: '2026-11-25', type: 'ENTRADA', rejected: false }],
      requests: [],
      certificates: [],
      today: '2026-11-25',
      month: '2026-11',
      openPendencias: [],
    });
    expect(r.people[0].incompletos).not.toContain('2026-11-25');
  });
});

describe('painel: cliques, atestado e Portaria 671', () => {
  it('Competência não tem seta de seletor; abre a folha', () => {
    expect(dashboard).toMatch(/onClick=\{\(\) => go\('folha'\)\}[^>]*>Folha de \{competencia\}/);
    expect(dashboard).not.toMatch(/Competência \{competencia\} ▾/);
  });

  it('selo Retorno 14:00 só é botão quando há restantes; senão não parece clicável', () => {
    expect(hoje).toContain('isLate14Suggestion');
    expect(hoje).toMatch(/late14[\s\S]*tag btn|tag btn[\s\S]*late14/);
    expect(hoje).toContain('“Retorno 14:00”');
  });

  it('Lançar atestado da gaveta abre a tela com pessoa e data preenchidas', () => {
    expect(atestado).toContain('initialEmployeeId');
    expect(atestado).toContain('initialDate');
    expect(dashboard).toContain('openAtestado');
    expect(dashboard).toContain('initialEmployeeId={atestadoFocus');
    expect(drawers).toContain('onOpenAtestado');
  });

  it('rotas Hoje e fechamento são só leitura', () => {
    expect(hojeRoute).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
    expect(fechamentoRoute).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
    expect(fechamentoRoute).toContain('buildClosing');
  });

  it('aceitar/corrigir na gaveta usa a rota de pendências já existente (originais intactas, auditoria)', () => {
    expect(drawers).toContain("/api/admin/pendencias");
    expect(drawers).toContain("Batidas originais não são alteradas");
    expect(drawers).toContain("'ACEITAR'");
  });

  it('nome curto e cargo', () => {
    expect(shortName('MARIA REVIANE DANTAS DA SILVA RESENDE')).toBe('Maria Reviane');
    expect(capJob('ASSISTENTE SOCIAL')).toBe('Assistente social');
  });
});
