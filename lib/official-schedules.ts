export type OfficialSchedule = {
  scheduleStart: string;
  scheduleEnd: string;
  regime: 'INTEGRAL' | 'MEIO_EXPEDIENTE';
  lunchMinutes: number;
};

/** Horários autorizados pela administração do Espaço Progredir. */
export const OFFICIAL_SCHEDULES: readonly OfficialSchedule[] = [
  { scheduleStart: '07:00', scheduleEnd: '16:00', regime: 'INTEGRAL', lunchMinutes: 60 },
  { scheduleStart: '07:30', scheduleEnd: '16:30', regime: 'INTEGRAL', lunchMinutes: 60 },
  { scheduleStart: '08:00', scheduleEnd: '17:00', regime: 'INTEGRAL', lunchMinutes: 60 },
  { scheduleStart: '12:00', scheduleEnd: '16:00', regime: 'MEIO_EXPEDIENTE', lunchMinutes: 0 },
] as const;

export function clockMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function officialScheduleKey(schedule: Pick<OfficialSchedule, 'scheduleStart' | 'scheduleEnd'>) {
  return `${schedule.scheduleStart}-${schedule.scheduleEnd}`;
}

/**
 * Arredonda qualquer padrão observado para um horário aprovado.
 * O turno curto observado no fim da manhã/início da tarde é tratado como
 * meio expediente somente quando o padrão está na janela do turno 12–16.
 */
export function normalizeToOfficialSchedule(scheduleStart: string, scheduleEnd: string): OfficialSchedule {
  const start = clockMinutes(scheduleStart);
  const end = clockMinutes(scheduleEnd);
  const observedSpan = Math.max(0, end - start);

  if (start >= 10 * 60 + 30 && observedSpan <= 6 * 60) {
    return OFFICIAL_SCHEDULES[3];
  }

  const integralSchedules = OFFICIAL_SCHEDULES.slice(0, 3);
  return integralSchedules.reduce((closest, candidate) => {
    const distance = Math.abs(clockMinutes(candidate.scheduleStart) - start) + Math.abs(clockMinutes(candidate.scheduleEnd) - end);
    const closestDistance = Math.abs(clockMinutes(closest.scheduleStart) - start) + Math.abs(clockMinutes(closest.scheduleEnd) - end);
    return distance < closestDistance ? candidate : closest;
  }, integralSchedules[0]);
}

export function isOfficialSchedule(scheduleStart: string | null, scheduleEnd: string | null) {
  return Boolean(scheduleStart && scheduleEnd && OFFICIAL_SCHEDULES.some((item) => item.scheduleStart === scheduleStart && item.scheduleEnd === scheduleEnd));
}
