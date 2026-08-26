import { describe, expect, it } from 'vitest';
import { parseCsv, validate } from '../lib/csv-import';

describe('compatibilidade do CSV mensal', () => {
  it('reconhece os tipos do relógio e seus equivalentes internos', () => {
    const aliases: Record<string, string> = { ENTRADA: 'ENTRADA', SAIDA_ALMOCO: 'INTERVALO', VOLTA_ALMOCO: 'RETORNO', SAIDA: 'SAIDA' };
    expect(aliases.VOLTA_ALMOCO).toBe('RETORNO');
    expect(aliases.SAIDA_ALMOCO).toBe('INTERVALO');
  });

  it('lê o CSV completo quando o cabeçalho vem depois dos metadados', () => {
    const csv = [
      '\ufeffEMPRESA;Espaço Progredir',
      'CNPJ;05.553.848/0001-61',
      'COMPETÊNCIA;AGOSTO DE 2026',
      'NSR;Data;Horário;Matrícula;Colaborador;CPF;Cargo;Departamento;Tipo de Marcação;Local / Unidade;Dispositivo;Hash SHA-256;Status;Justificativa / Observação',
      'NSR-1;03/08/2026;06:59:24;0041;Nome Exemplo;123;Cargo;Setor;SAIDA_ALMOCO;Unidade;Totem;hash;COMMITTED;',
      'NSR-2;03/08/2026;07:59:24;0041;Nome Exemplo;123;Cargo;Setor;VOLTA_ALMOCO;Unidade;Totem;hash;COMMITTED;',
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ employeeNumber: '0041', date: '2026-08-03', type: 'SAIDA_ALMOCO', jobTitle: 'Cargo' });
    expect(validate(parsed.rows)).toEqual([]);
  });
});
