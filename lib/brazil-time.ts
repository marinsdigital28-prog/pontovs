const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

export function brazilDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BRAZIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function brazilDayRange(date = new Date()) {
  const key = brazilDateKey(date);
  const start = new Date(`${key}T00:00:00-03:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function brazilDayEnd(date = new Date()) {
  return brazilDayRange(date).end;
}
