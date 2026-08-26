export const manualPunchTypes = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'] as const;
export type ManualPunchType = (typeof manualPunchTypes)[number];

export function parseManualTimestamp(dateValue: unknown, timeValue: unknown) {
  const date = String(dateValue ?? '').trim();
  const time = String(timeValue ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function manualClientId(employeeId: string, date: string, time: string, type: string) {
  return `manual-${employeeId}-${date}T${time}-${type.toUpperCase()}`;
}
