export type StoredSchedule = { workDays: string | null; scheduleStart: string | null; scheduleEnd: string | null };
export type SuggestedSchedule = { workDays: string; scheduleStart: string; scheduleEnd: string };

export function mergeInferredSchedule(current: StoredSchedule | null, suggested: SuggestedSchedule) {
  const merged = {
    workDays: current?.workDays || suggested.workDays,
    scheduleStart: current?.scheduleStart || suggested.scheduleStart,
    scheduleEnd: current?.scheduleEnd || suggested.scheduleEnd,
  };
  const applied = !current?.workDays || !current.scheduleStart || !current.scheduleEnd;
  return { ...merged, applied };
}
