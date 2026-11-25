import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shortName } from '../lib/short-name';

const root = process.cwd();
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const page = readFileSync(resolve(root, 'app/admin/page.tsx'), 'utf8');
const hojeRoute = readFileSync(resolve(root, 'app/api/admin/hoje/route.ts'), 'utf8');
const hoje = readFileSync(resolve(root, 'app/admin/hoje-v2.tsx'), 'utf8');

describe('painel v2 (arte aprovada)', () => {
  it('contador de pendências tem fonte única (Pendencia OPEN) no card, no sino e no menu', () => {
    expect(page).toContain("prisma.pendencia.count({ where: { status: 'OPEN' } })");
    expect(page).not.toContain('prisma.inconsistency.count');
    expect(hojeRoute).toContain("prisma.pendencia.findMany({ where: { status: 'OPEN' }");
    expect(hojeRoute).toContain('openCount: openPend.length');
    expect(dashboard).toContain('setPendCount(hoje.data.openCount)');
    expect(hoje).toContain('<b>{data.openCount}</b>');
  });
  it('menu da arte: Rotina / Cadastro e registros / Sistema; Pontinho flutuante oculto', () => {
    for (const t of ["'◎ Hoje'", "'✦ Sugestões'", "'✉ Pedidos'", "'👥 Pessoas'", "'🕘 Ponto'", "'📅 Ausências'", "'📄 Folha de ponto'", "'⚙ Configurações'"]) expect(dashboard).toContain(t);
    expect(dashboard).not.toContain('<PontinhoChat');
    expect(dashboard).toContain('pv2-tabbar');
  });
  it('sem alertas de atraso no painel Hoje', () => {
    expect(hoje).not.toMatch(/Atraso/);
  });
  it('rota Hoje é só leitura (não grava batidas)', () => {
    expect(hojeRoute).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });
  it('nome curto legível', () => {
    expect(shortName('CRISTIANO FERREIRA DA SILVA')).toBe('Cristiano Ferreira');
    expect(shortName('ANA MARIA DOS SANTOS CAVALCANTE')).toBe('Ana Maria');
    expect(shortName('Renata da Conceição Felippe de Sá')).toBe('Renata Conceição');
  });
});
