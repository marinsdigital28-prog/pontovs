import { describe, expect, it } from 'vitest';
import { databaseUnavailableResponse, isDatabaseQuotaExceeded } from '../lib/database-errors';

describe('database errors', () => {
  it('identifica a cota de transferência excedida', () => {
    expect(isDatabaseQuotaExceeded(new Error('Your project has exceeded the data transfer quota.'))).toBe(true);
  });

  it('não classifica erros comuns como cota excedida', () => {
    expect(isDatabaseQuotaExceeded(new Error('connection reset'))).toBe(false);
  });

  it('retorna uma mensagem operacional sem expor detalhes do provedor', () => {
    expect(databaseUnavailableResponse()).toEqual({
      error: 'O banco de dados está temporariamente indisponível porque a cota de transferência foi excedida. Libere a cota no provedor do banco e tente novamente.',
      code: 'DATABASE_QUOTA_EXCEEDED',
      retryable: true,
    });
  });
});
