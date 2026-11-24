/** Hábito pessoal (últimos 60 dias de batidas originais, tipo efetivo) para o totem/app. */
import prisma from './prisma';
import { dateKeyOf, hmOf, toMin } from './auto-close';
import { computeHabit, slot, type Habit, type HistoryDay } from './punch-classifier';
import { applyInterpretations, isOriginalPunch, loadInterpretations } from './punch-interpretation';

export async function loadHabit(userId: string, beforeDate: string): Promise<Habit | null> {
  try {
    const to = new Date(`${beforeDate}T00:00:00-03:00`);
    const from = new Date(to.getTime() - 61 * 86_400_000);
    const rows = await prisma.punch.findMany({ where: { userId, status: 'VALID', timestamp: { gte: from, lt: to } }, select: { id: true, type: true, timestamp: true, origin: true, clientId: true }, orderBy: { timestamp: 'asc' } });
    const originals = rows.filter((r) => isOriginalPunch(r));
    const eff = applyInterpretations(originals, await loadInterpretations(originals.map((r) => r.id)));
    const days: HistoryDay[] = [];
    for (const p of eff) {
      const date = dateKeyOf(p.timestamp);
      let day = days[days.length - 1];
      if (!day || day.date !== date) { day = { date, punches: [] }; days.push(day); }
      day.punches.push({ type: p.type, min: toMin(hmOf(p.timestamp)) });
    }
    return computeHabit(days, beforeDate);
  } catch {
    return null;
  }
}

export function habitLunch(h: Habit | null) {
  return h ? { start: slot(h.INTERVALO), minutes: h.lunch } : null;
}
