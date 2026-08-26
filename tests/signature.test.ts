import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const route = readFileSync(resolve(root, 'app/api/admin/signature/route.ts'), 'utf8');
const settings = readFileSync(resolve(root, 'app/admin/signature-settings.tsx'), 'utf8');
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const timesheet = readFileSync(resolve(root, 'app/admin/folha-ponto-panel.tsx'), 'utf8');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');

describe('assinatura institucional', () => {
  it('protege a leitura e a gravação por sessão de gestor', () => {
    expect(route).toContain("role: { in: ['ADMIN', 'MANAGER'] }");
    expect(route).toContain('signatureData');
    expect(route).toContain('INSTITUTION_SIGNATURE_UPDATED');
    expect(route).toContain('INSTITUTION_SIGNATURE_REMOVED');
  });

  it('oferece upload limitado a imagens e remoção no painel', () => {
    expect(settings).toContain('image/png,image/jpeg,image/webp');
    expect(settings).toContain('2 * 1024 * 1024');
    expect(settings).toContain('Remover assinatura');
    expect(dashboard).toContain("import SignatureSettings from './signature-settings'");
    expect(dashboard).toContain('<SignatureSettings />');
  });

  it('persiste a assinatura e a renderiza no documento', () => {
    expect(schema).toContain('signatureData         String?  @db.Text');
    expect(timesheet).toContain("fetch('/api/admin/signature'");
    expect(timesheet).toContain('Assinatura digital do Espaço Progredir');
    expect(timesheet).toContain('institution-signature');
  });
});
