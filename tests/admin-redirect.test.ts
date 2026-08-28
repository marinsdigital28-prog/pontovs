import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../app/admin/page.tsx', import.meta.url), 'utf8');

describe('acesso administrativo', () => {
  it('retorna sessão sem permissão ao login do gestor, nunca ao relógio de ponto', () => {
    expect(source).toContain("redirect('/auth/signin?callbackUrl=%2Fadmin')");
    expect(source).not.toContain("if (!manager) redirect('/ponto')");
  });
});
