import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const DEFAULT_FROM = 'Marins Digital Sistemas <ponto@marinsdistemas.xyz>';

type ReceiptInput = {
  to: string;
  employeeName: string;
  employeeNumber: string | null;
  type: string;
  timestamp: Date | string;
  photoData?: string | null;
};

export type ReceiptEmailResult =
  | { status: 'sent'; id: string }
  | { status: 'not_configured' }
  | { status: 'failed'; error: string };

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function dataUrlToBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') };
}

async function createReceiptPdf(input: ReceiptInput) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 420]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.03, 0.25, 0.18);
  const gold = rgb(0.83, 0.69, 0.22);
  const dark = rgb(0.08, 0.12, 0.10);
  const light = rgb(0.94, 0.98, 0.95);

  page.drawRectangle({ x: 0, y: 350, width: 595, height: 70, color: green });
  page.drawRectangle({ x: 0, y: 346, width: 595, height: 4, color: gold });
  page.drawText('MARINS DIGITAL SISTEMAS', { x: 28, y: 387, size: 16, font: bold, color: rgb(1, 1, 1) });
  page.drawText('COMPROVANTE DE REGISTRO DE PONTO', { x: 28, y: 366, size: 10, font: regular, color: light });

  page.drawRectangle({ x: 28, y: 252, width: 539, height: 68, color: light, borderColor: rgb(0.76, 0.86, 0.79), borderWidth: 1 });
  page.drawText('PONTO REGISTRADO', { x: 45, y: 294, size: 11, font: bold, color: green });
  page.drawText(input.type, { x: 45, y: 268, size: 25, font: bold, color: dark });
  page.drawText(formatDateTime(input.timestamp), { x: 190, y: 275, size: 12, font: regular, color: dark });

  page.drawText(`Colaborador: ${input.employeeName}`, { x: 40, y: 220, size: 12, font: bold, color: dark });
  page.drawText(`Matrícula: ${input.employeeNumber || 'Não informada'}`, { x: 40, y: 198, size: 11, font: regular, color: dark });
  page.drawText('Este comprovante confirma o registro realizado no sistema de ponto.', { x: 40, y: 155, size: 10, font: regular, color: dark });
  page.drawText('Guarde este email para seus registros.', { x: 40, y: 137, size: 10, font: regular, color: dark });

  const image = input.photoData ? dataUrlToBytes(input.photoData) : null;
  if (image) {
    try {
      const embedded = image.mime === 'image/png' ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes);
      const scaled = embedded.scale(1);
      const max = 92;
      const ratio = Math.min(max / scaled.width, max / scaled.height, 1);
      page.drawImage(embedded, { x: 460, y: 125, width: scaled.width * ratio, height: scaled.height * ratio });
      page.drawText('Evidência fotográfica', { x: 450, y: 112, size: 7, font: regular, color: green });
    } catch {
      // A foto não impede o envio do comprovante textual.
    }
  }

  page.drawLine({ start: { x: 40, y: 82 }, end: { x: 555, y: 82 }, thickness: 0.7, color: rgb(0.75, 0.82, 0.77) });
  page.drawText('Marins Digital Sistemas · Sistema de controle de jornada', { x: 40, y: 60, size: 8.5, font: regular, color: green });
  page.drawText('Email automático — não responda esta mensagem.', { x: 40, y: 45, size: 8, font: regular, color: dark });
  return Buffer.from(await pdf.save());
}

export async function sendPunchReceiptEmail(input: ReceiptInput): Promise<ReceiptEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const pdf = await createReceiptPdf(input);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Comprovante de ponto · ${input.type} · ${formatDateTime(input.timestamp)}`,
      html: `<p>Olá, <strong>${input.employeeName}</strong>.</p><p>Seu registro de ponto foi realizado com sucesso.</p><p><strong>Tipo:</strong> ${input.type}<br/><strong>Data e hora:</strong> ${formatDateTime(input.timestamp)}<br/><strong>Matrícula:</strong> ${input.employeeNumber || 'Não informada'}</p><p>O comprovante está anexado a esta mensagem.</p><p>Atenciosamente,<br/><strong>Marins Digital Sistemas</strong></p>`,
      attachments: [{ filename: `comprovante-ponto-${input.type.toLowerCase()}.pdf`, content: pdf.toString('base64') }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { status: 'failed', error: `Resend ${response.status}: ${body.slice(0, 240)}` };
  }
  const data = await response.json() as { id?: string };
  return data.id ? { status: 'sent', id: data.id } : { status: 'failed', error: 'Resend não retornou o identificador do email.' };
}
