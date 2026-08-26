import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const authSource = fs.readFileSync(new URL('../lib/auth.ts', import.meta.url), 'utf8');
const importSource = fs.readFileSync(new URL('../app/api/admin/import-pdf/route.ts', import.meta.url), 'utf8');

describe('autorização de importação sem senha técnica repetida', () => {
  it('aceita os nomes de senha existentes no Vercel', () => {
    expect(authSource).toContain('process.env.SENHA_DE_ADMINISTRADOR');
    expect(authSource).toContain('process.env.SENHA_DE_ACESSO_DE_ADMINISTRADOR');
  });

  it('permite sessão de gestor no importador PDF', () => {
    expect(importSource).toContain('getServerSession');
    expect(importSource).toContain("role: { in: ['ADMIN', 'MANAGER'] }");
  });
});
