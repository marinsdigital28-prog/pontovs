import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('credencial de importação', () => {
  it('mantém o endpoint protegido por uma credencial de ambiente', () => {
    const source = fs.readFileSync(new URL('../app/api/admin/import-pdf/route.ts', import.meta.url), 'utf8');
    expect(source).toContain('process.env.ADMIN_PASSWORD');
    expect(source).toContain('x-import-token');
  });
});
