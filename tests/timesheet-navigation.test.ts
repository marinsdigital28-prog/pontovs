import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8');
const timesheet = readFileSync(resolve(root, 'app/admin/folha-ponto-panel.tsx'), 'utf8');
const punch = readFileSync(resolve(root, 'app/ponto/page.tsx'), 'utf8');
const employeePortal = readFileSync(resolve(root, 'app/colaborador/page.tsx'), 'utf8');


describe('navegação da folha de ponto', () => {
  it('declara a Folha de ponto no menu administrativo', () => {
    expect(dashboard).toContain("['timesheet', 'Folha de ponto']");
    expect(dashboard).toContain('aria-label="Seções administrativas"');
    expect(dashboard).toContain('aria-current={tab === key ? \'page\' : undefined}');
  });

  it('mantém todas as abas visíveis no menu móvel', () => {
    expect(css).toContain('.admin-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(css).toContain('.admin-tabs button:nth-child(5){border:2px solid var(--gold)');
  });

  it('exibe a confirmação animada e protege a marcação offline', () => {
    expect(punch).toContain('MARCAÇÃO CONFIRMADA');
    expect(punch).toContain('confirmation-ball');
    expect(punch).toContain('Sem conexão — marcação protegida no aparelho');
    expect(punch).toContain('response.status !== 409');
  });

  it('configura a folha individual para preencher a área útil A4 na impressão', () => {
    expect(css).toContain('min-height:190mm');
    expect(css).toContain('size:A4 landscape');
    expect(css).toContain('.individual-table-section .individual-timesheet-table{width:100%;height:100%}');
  });

  it('declara o portal integrado do colaborador', () => {
    expect(employeePortal).toContain('Área do colaborador');
    expect(employeePortal).toContain('/api/employee/history');
    expect(employeePortal).not.toContain('href="/ponto"');
    expect(employeePortal).toContain('BATIDA SOMENTE NO RELÓGIO');
    expect(employeePortal).toContain('Informar ausência');
    expect(employeePortal).toContain('Trocar dia');
    expect(employeePortal).toContain('Minhas informações');
    expect(employeePortal).toContain('modo de teste local');
  });

  it('renderiza uma folha individual no modelo diário', () => {
    expect(timesheet).toContain('RELATÓRIO DE PONTO DO COLABORADOR');
    expect(timesheet).toContain('<th>H.Trab</th>');
    expect(timesheet).toContain('<th>H.Prev</th>');
    expect(timesheet).toContain('<th>Saldo</th>');
    expect(timesheet).toContain('Assinatura do Colaborador');
    expect(timesheet).toContain('Selecione um colaborador');
  });
});
