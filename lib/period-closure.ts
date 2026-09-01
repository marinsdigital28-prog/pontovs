import prisma from './prisma';
import { brazilDateKey } from './brazil-time';

export const PERIOD_CLOSED_ACTION = 'TIMESHEET_CLOSED';
export const PERIOD_REOPENED_ACTION = 'TIMESHEET_REOPENED';

export function periodBounds(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [year, month] = period.split('-').map(Number);
  const start = new Date(`${period}-01T00:00:00-03:00`);
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const end = new Date(`${nextMonth}-01T00:00:00-03:00`);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
}

export function periodFromDate(value: Date) { return brazilDateKey(value).slice(0, 7); }

export async function getPeriodStatus(period: string) {
  const events = await prisma.securityAuditEvent.findMany({ where: { action: { in: [PERIOD_CLOSED_ACTION, PERIOD_REOPENED_ACTION] }, metadataJson: { contains: `\"period\":\"${period}\"` } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, action: true, actorId: true, createdAt: true, metadataJson: true } });
  const latest = events[0] || null;
  return { closed: latest?.action === PERIOD_CLOSED_ACTION, latest };
}

export async function isPeriodClosed(period: string) {
  return (await getPeriodStatus(period)).closed;
}
