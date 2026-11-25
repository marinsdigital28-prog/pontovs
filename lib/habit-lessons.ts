/**
 * Persistência das correções do gestor (tabela HabitLesson).
 * Nunca altera Punch. Se a tabela ainda não existir, só registra o erro e segue.
 */
import prisma from './prisma';
import { weekdayOf, type Lesson, type LessonKind, type LessonSource } from './habit-learn';
import type { PType } from './punch-classifier';

export async function recordLesson(input: {
  userId: string;
  date: string;
  type: string;
  minutes: number;
  kind: LessonKind;
  source: LessonSource;
  actorId: string;
  punchId?: string | null;
  fromType?: string | null;
}): Promise<void> {
  try {
    await prisma.habitLesson.upsert({
      where: { userId_date_type_kind: { userId: input.userId, date: input.date, type: input.type, kind: input.kind } },
      create: {
        userId: input.userId,
        date: input.date,
        weekday: weekdayOf(input.date),
        type: input.type,
        minutes: input.minutes,
        kind: input.kind,
        fromType: input.fromType ?? null,
        punchId: input.punchId ?? null,
        source: input.source,
        actorId: input.actorId,
      },
      update: {
        weekday: weekdayOf(input.date),
        minutes: input.minutes,
        fromType: input.fromType ?? null,
        punchId: input.punchId ?? null,
        source: input.source,
        actorId: input.actorId,
      },
    });
  } catch (error) {
    console.error('[habit-lessons] gravação indisponível:', (error as Error).message);
  }
}

export async function loadLessons(userId: string, beforeDate: string): Promise<Lesson[]> {
  try {
    const rows = await prisma.habitLesson.findMany({
      where: { userId, date: { lt: beforeDate } },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: r.date,
      type: r.type as PType,
      min: r.minutes,
      kind: r.kind as LessonKind,
      source: r.source as LessonSource,
      fromType: r.fromType ?? undefined,
    }));
  } catch (error) {
    console.error('[habit-lessons] leitura indisponível:', (error as Error).message);
    return [];
  }
}

export async function loadLessonsByUsers(userIds: string[], beforeDate: string): Promise<Map<string, Lesson[]>> {
  const map = new Map<string, Lesson[]>();
  if (!userIds.length) return map;
  try {
    const rows = await prisma.habitLesson.findMany({
      where: { userId: { in: userIds }, date: { lt: beforeDate } },
      orderBy: { date: 'asc' },
    });
    for (const r of rows) {
      const list = map.get(r.userId) || [];
      list.push({
        date: r.date,
        type: r.type as PType,
        min: r.minutes,
        kind: r.kind as LessonKind,
        source: r.source as LessonSource,
        fromType: r.fromType ?? undefined,
      });
      map.set(r.userId, list);
    }
  } catch (error) {
    console.error('[habit-lessons] leitura em lote indisponível:', (error as Error).message);
  }
  return map;
}
