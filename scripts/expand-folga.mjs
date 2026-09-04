import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellPath = path.join(root, 'app/app/employee-shell.tsx');
let t = fs.readFileSync(shellPath, 'utf8');

if (!t.includes('workDayInfo')) {
  const workDayBlock = `
  const workDayInfo = useMemo(() => {
    const DAY_CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
    const wdLabel = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, weekday: 'short' }).format(new Date());
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = map[wdLabel] ?? new Date().getDay();
    const dayCode = DAY_CODES[weekday];
    const workDaysRaw = String(data?.employee?.workDays || '').toUpperCase().replace(/\u00C1/g, 'A');
    const byDay = data?.employee?.scheduleByDay as Record<string, unknown> | null | undefined;
    let hasOverride = false;
    if (byDay && typeof byDay === 'object') {
      const key = Object.keys(byDay).find((k) => String(k).toUpperCase().replace(/\u00C1/g, 'A') === dayCode);
      if (key) hasOverride = true;
    }
    let worksToday = true;
    if (hasOverride) worksToday = true;
    else if (workDaysRaw) {
      if (workDaysRaw.trim().startsWith('[')) {
        try {
          const arr = JSON.parse(String(data?.employee?.workDays || '[]')) as string[];
          worksToday = arr.map((x) => String(x).toUpperCase().replace(/\u00C1/g, 'A')).includes(dayCode);
        } catch { worksToday = workDaysRaw.includes(dayCode); }
      } else worksToday = workDaysRaw.includes(dayCode);
    } else worksToday = weekday >= 1 && weekday <= 5;
    return {
      worksToday,
      dayCode,
      message: worksToday ? null : ((weekday === 0 || weekday === 6)
        ? 'Hoje é sua folga. Sem expediente.'
        : 'Hoje não tem expediente na sua escala.'),
    };
  }, [data?.employee?.workDays, data?.employee?.scheduleByDay]);
`;
  t = t.replace('  const missingPunchHint = useMemo(() => {', workDayBlock + '\n  const missingPunchHint = useMemo(() => {');
}

if (!t.includes('if (workDayInfo && !workDayInfo.worksToday) return null')) {
  t = t.replace(
    '  const missingPunchHint = useMemo(() => {\n    const start = data?.employee?.scheduleStart;',
    '  const missingPunchHint = useMemo(() => {\n    if (workDayInfo && !workDayInfo.worksToday) return null as null | { type: string; label: string; message: string };\n    const start = data?.employee?.scheduleStart;',
  );
}

if (!t.includes('Folga · sem expediente')) {
  t = t.replace(
    "    let tone = 'neutral';\n\n    if (types.has('SAIDA') && types.has('ENTRADA'))",
    "    let tone = 'neutral';\n    if (workDayInfo && workDayInfo.worksToday === false) {\n      return { title: 'Folga · sem expediente', detail: workDayInfo.message || 'Hoje não há expediente na sua escala.', nextExpected: null, delayMin: null, tone: 'neutral', typesCount: todayPunches.length, isOff: true };\n    }\n\n    if (types.has('SAIDA') && types.has('ENTRADA'))",
  );
  t = t.replace(
    "    let tone = 'neutral';\n    if (types.has('SAIDA') && types.has('ENTRADA'))",
    "    let tone = 'neutral';\n    if (workDayInfo && workDayInfo.worksToday === false) {\n      return { title: 'Folga · sem expediente', detail: workDayInfo.message || 'Hoje não há expediente na sua escala.', nextExpected: null, delayMin: null, tone: 'neutral', typesCount: todayPunches.length, isOff: true };\n    }\n    if (types.has('SAIDA') && types.has('ENTRADA'))",
  );
}

if (!t.includes('emp-offday')) {
  const offBanner =
    '{!workDayInfo.worksToday ? (\n' +
    '              <div className="emp-offday">\n' +
    '                <span className="emp-radar-eyebrow">ESCALA</span>\n' +
    '                <strong>{workDayInfo.message}</strong>\n' +
    '                <p>Se precisar avisar a ADM, use o SOS abaixo.</p>\n' +
    '              </div>\n' +
    '            ) : null}\n' +
    '            ';
  t = t.replace(
    '<div className={`emp-radar tone-${journeyRadar.tone}`}>',
    offBanner + '<div className={`emp-radar tone-${journeyRadar.tone}`}>',
  );
}

fs.writeFileSync(shellPath, t);
console.log('folga applied', t.includes('workDayInfo'), t.includes('emp-offday'), t.length);
