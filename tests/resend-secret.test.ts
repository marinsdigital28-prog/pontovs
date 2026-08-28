import { describe, expect, it } from 'vitest';

describe.skipIf(!process.env.RUN_RESEND_TEST)('configuração do Resend', () => {
  it('aceita a chave configurada no endpoint leve de domínios', async () => {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    expect(key).toBeTruthy();
    expect(from).toBeTruthy();
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(response.status).toBe(200);
  });
});
