import { describe, expect, it } from 'vitest';
import { isCallAssignment, normalizeCallAssignments, readCallAssignments } from '../lib/call-assignments';

const generalAssignment = {
  id: 'quadra-crescer',
  kind: 'GENERAL',
  program: 'CRESCER',
  turmaId: 'turma-real',
  activity: null,
  shift: 'MANHA',
  slot: 1,
  days: ['SEG'],
  startTime: '08:00',
  endTime: '09:00',
  active: true,
} as const;

describe('regras de chamada do Módulo 3', () => {
  it('aceita chamada geral no Espaço Crescer', () => {
    expect(isCallAssignment(generalAssignment)).toBe(true);
    expect(normalizeCallAssignments([generalAssignment]).assignments).toEqual([generalAssignment]);
  });

  it('rejeita chamada geral no Espaço Jovem no salvamento', () => {
    const result = normalizeCallAssignments([{ ...generalAssignment, program: 'JOVEM' }]);
    expect(result.assignments).toBeUndefined();
    expect(result.error).toMatch(/exclusiva do Espaço Crescer/i);
  });

  it('ignora vínculo geral de Espaço Jovem que já esteja salvo no perfil', () => {
    const profile = JSON.stringify({ callAssignments: [{ ...generalAssignment, program: 'JOVEM' }] });
    expect(readCallAssignments(profile)).toEqual([]);
  });
});
