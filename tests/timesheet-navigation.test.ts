import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dashboard = readFileSync(resolve(root, 'app/admin/admin-dashboard.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8');

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
});
