import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(new URL('../app/admin/admin-dashboard.tsx', import.meta.url), 'utf8');

describe('sincronização do cadastro com a Folha de Ponto', () => {
  it('passa o colaborador completo para a folha, incluindo cargo, dias e jornada', () => {
    expect(dashboard).toContain("<FolhaPontoPanel employees={employees.filter((item) => item.active)} />");
    expect(dashboard).not.toContain("<FolhaPontoPanel employees={employees.filter((item) => item.active).map(({ id, name, employeeNumber }) => ({ id, name, employeeNumber }))} />");
  });
});
