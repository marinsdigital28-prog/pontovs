/**
 * Conflito atestado × marcação: a pessoa não pode estar em dois lugares ao mesmo tempo.
 * - Atestado/trabalho externo dia integral → qualquer marcação VALID no dia conflita.
 * - Atestado/trabalho externo por horas → marcação cujo horário (fuso SP) cai no intervalo [início, fim].
 */

const APP_TZ = 'America/Sao_Paulo';

export type ConflictCertificate = {
  id?: string;
  userId: string;
  type?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  startTime?: string | null;
  endTime?: string | null;
  status: string;
};

export type ConflictPunch = {
  id: string;
  userId: string;
  type: string;
  timestamp: Date;
  status: string;
};

function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toLocaleDateString('en-CA', { timeZone: APP_TZ });
}

function minutesOfDay(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function clockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const match = clock.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isActiveCertificateStatus(status: string): boolean {
  return status === 'APROVADO' || status === 'ATIVO';
}

/** Verifica se a marcação cai dentro da janela do atestado. */
export function punchConflictsWithCertificate(
  punch: { timestamp: Date; userId?: string },
  certificate: ConflictCertificate,
): boolean {
  if (!isActiveCertificateStatus(certificate.status)) return false;
  if (certificate.userId && punch.userId && certificate.userId !== punch.userId) return false;

  const punchDate = toDateKey(punch.timestamp);
  const startKey = toDateKey(certificate.startDate);
  const endKey = toDateKey(certificate.endDate);
  if (punchDate < startKey || punchDate > endKey) return false;

  const startMin = clockToMinutes(certificate.startTime);
  const endMin = clockToMinutes(certificate.endTime);
  // Dia integral (sem hora) → qualquer ponto no dia
  if (startMin === null || endMin === null) return true;

  const punchMin = minutesOfDay(punch.timestamp);
  return punchMin >= startMin && punchMin <= endMin;
}

/** Filtra marcações que não conflitam com nenhum atestado ativo do colaborador. */
export function filterPunchesOutsideCertificates<T extends { timestamp: Date; userId?: string }>(
  punches: T[],
  certificates: ConflictCertificate[],
  userId?: string,
): T[] {
  const relevant = certificates.filter(
    (c) => isActiveCertificateStatus(c.status) && (!userId || c.userId === userId),
  );
  if (!relevant.length) return punches;
  return punches.filter(
    (punch) => !relevant.some((cert) => punchConflictsWithCertificate(punch, cert)),
  );
}

export function findConflictingPunches(
  punches: ConflictPunch[],
  certificates: ConflictCertificate[],
): Array<{ punch: ConflictPunch; certificate: ConflictCertificate }> {
  const active = certificates.filter((c) => isActiveCertificateStatus(c.status));
  const out: Array<{ punch: ConflictPunch; certificate: ConflictCertificate }> = [];
  for (const punch of punches) {
    if (punch.status !== 'VALID') continue;
    for (const cert of active) {
      if (cert.userId !== punch.userId) continue;
      if (punchConflictsWithCertificate(punch, cert)) {
        out.push({ punch, certificate: cert });
        break;
      }
    }
  }
  return out;
}
