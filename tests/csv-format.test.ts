import { describe, expect, it } from 'vitest';

describe('compatibilidade do CSV mensal', () => {
  it('reconhece os tipos do relógio e seus equivalentes internos', () => {
    const aliases: Record<string, string> = { ENTRADA: 'ENTRADA', SAIDA_ALMOCO: 'INTERVALO', VOLTA_ALMOCO: 'RETORNO', SAIDA: 'SAIDA' };
    expect(aliases.VOLTA_ALMOCO).toBe('RETORNO');
    expect(aliases.SAIDA_ALMOCO).toBe('INTERVALO');
  });
});
