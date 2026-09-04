import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8');
const timesheet = readFileSync(resolve(root, 'app/admin/folha-ponto-panel.tsx'), 'utf8');
const timesheetPdfRoute = readFileSync(resolve(root, 'app/api/admin/timesheet-pdf/route.ts'), 'utf8');
const signedTimesheetPdf = readFileSync(resolve(root, 'lib/signed-timesheet-pdf.ts'), 'utf8');
const punch = readFileSync(resolve(root, 'app/ponto/page.tsx'), 'utf8');
const employeePortal = readFileSync(resolve(root, 'app/colaborador/page.tsx'), 'utf8');
const csvImporter = readFileSync(resolve(root, 'app/admin/csv-importer.tsx'), 'utf8');
const csvRoute = readFileSync(resolve(root, 'app/api/admin/import-csv/route.ts'), 'utf8');


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

  it('mantém a tela de marcação no padrão de totem com identificação, câmera e confirmação', () => {
    expect(css).toContain('html,body{overflow:hidden}');
    expect(css).toContain('.ponto-kiosk-card{height:calc(100dvh - 3.95rem)');
    expect(css).toContain('.ponto-input-panel .camera-preview-minimal{width:min(76vw,330px)');
    expect(punch).toContain('ponto-kiosk-container');
    expect(punch).toContain('ponto-info-panel');
    expect(punch).toContain('ponto-input-panel');
    expect(punch).toContain('Digite seu número de matrícula');
    expect(punch).toContain('Marcar ponto');
    expect(punch).toContain('Ponto registrado');
  });

  it('exibe a confirmação animada e protege a marcação offline', () => {
    expect(punch).toContain('Ponto registrado');
    expect(punch).toContain('Marcação salva no aparelho');
    expect(punch).toContain('confirmation-check');
    expect(punch).toContain('Sem conexão — marcação protegida no aparelho');
    expect(punch).toContain('DATABASE_QUOTA_EXCEEDED');
    expect(punch).toContain('if (!response.ok) remaining.push(p);');
  });

  it('tenta abrir a câmera automaticamente ao entrar na etapa de marcação', () => {
    expect(punch).toContain("if (step !== 'register' || !employee || cameraOpen || photo || confirmation || loading) return;");
    expect(punch).toContain('void handlePhotoSelection();');
    expect(punch).toContain('Abrir câmera');
  });

  it('configura a folha individual para preencher a área útil A4 na impressão', () => {
    expect(css).toContain('min-height:190mm');
    expect(css).toContain('size:A4 landscape');
    expect(css).toContain('.individual-table-section .individual-timesheet-table{width:100%;height:100%}');
  });

  it('declara o importador CSV seguro com prévia e confirmação', () => {
    expect(dashboard).toContain("import CsvImporter from './csv-importer'");
    expect(dashboard).toContain('<CsvImporter />');
    expect(csvImporter).toContain('Prévia da importação');
    expect(csvImporter).toContain('Confirmar importação');
    expect(csvImporter).toContain("/api/admin/import-csv");
    expect(csvRoute).toContain("role: { in: ['ADMIN', 'MANAGER'] }");
    expect(csvRoute).toContain('punchesExisting');
    expect(csvRoute).toContain("action: 'CSV_IMPORT'");
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

  it('renderiza uma folha individual A4 assinada no modelo diário', () => {
    expect(timesheet).toContain('PDF de todos');
    expect(timesheetPdfRoute).toContain('createSignedTimesheetPdfBatch');
    expect(timesheetPdfRoute).toContain('createSignedTimesheetPdf');
    expect(signedTimesheetPdf).toContain('A4 paisagem');
    expect(signedTimesheetPdf).toContain("'Data', 'Escala', 'Marcações', 'Trab.', 'Prev.', 'Just.', 'Saldo', 'Situação'");
    expect(signedTimesheetPdf).toContain('Assinado digitalmente');
    expect(signedTimesheetPdf).toContain('Espaço Progredir');
    expect(signedTimesheetPdf).toContain('Certificado A1');
    expect(signedTimesheetPdf).toContain('const footerReserve = 78');
  });
});
