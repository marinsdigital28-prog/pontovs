const QUOTA_ERROR_PATTERN = /(?:data transfer quota|exceeded the data transfer quota|quota.*(?:transfer|data)|transfer.*quota)/i;

export function isDatabaseQuotaExceeded(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return QUOTA_ERROR_PATTERN.test(message);
}

export function databaseUnavailableResponse() {
  return {
    error: 'O banco de dados está temporariamente indisponível porque a cota de transferência foi excedida. Libere a cota no provedor do banco e tente novamente.',
    code: 'DATABASE_QUOTA_EXCEEDED',
    retryable: true,
  } as const;
}
