import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPunchReceiptEmail } from '../lib/punch-receipt';

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  vi.restoreAllMocks();
});

describe('comprovante de ponto por email', () => {
  it('não tenta enviar quando a chave do Resend não está configurada', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await sendPunchReceiptEmail({
      to: 'funcionario@example.com', employeeName: 'Pessoa Teste', employeeNumber: '0001', type: 'ENTRADA', timestamp: new Date('2026-08-30T12:00:00Z'),
    });
    expect(result).toEqual({ status: 'not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('envia um PDF anexado com o remetente institucional', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'Marins Digital Sistemas <ponto@marinsdistemas.xyz>';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'email-test-1' }), { status: 200 }));
    const result = await sendPunchReceiptEmail({
      to: 'marinsdigital28@gmail.com', employeeName: 'Pessoa Teste', employeeNumber: '0001', type: 'ENTRADA', timestamp: new Date('2026-08-30T12:00:00Z'),
    });
    expect(result).toEqual({ status: 'sent', id: 'email-test-1' });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe('Marins Digital Sistemas <ponto@marinsdistemas.xyz>');
    expect(body.to).toEqual(['marinsdigital28@gmail.com']);
    expect(body.attachments[0].filename).toContain('comprovante-ponto-entrada.pdf');
    expect(body.attachments[0].content.length).toBeGreaterThan(100);
  });
});
