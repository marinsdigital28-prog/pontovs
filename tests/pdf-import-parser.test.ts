import { describe, expect, it } from 'vitest';
import { parseBackupText } from '../lib/pdf-import';

const samplePdfText = `Nome: MAICON FERNANDES MARINS CPF: *** Matrícula: 4041
Cargo: Professor Depto: Operação Unidade: Espaço Progredir
Escala: 07:00 às 17:00 Jornada: 09:00
26/08 Qua (07:00 às 17:00) 07:12:00 11:30:00 12:30:00 17:02:00   08:50:00`;

describe('parser do backup PDF', () => {
  it('extrai colaboradores e batidas com NSR estável', () => {
    const result = parseBackupText(samplePdfText);
    expect(result.employeeHeaders).toBe(1);
    expect(result.employees[0]?.employeeNumber).toBe('4041');
    expect(result.punches).toHaveLength(4);
    expect(result.punches.every((punch) => punch.sourceId.startsWith('pdf-'))).toBe(true);
    expect(new Set(result.punches.map((punch) => punch.sourceId)).size).toBe(result.punches.length);
  });
});
