export type ImportedEmployee = { employeeNumber: string; name: string; jobTitle?: string; department?: string };
export type ImportedPunch = { employeeNumber: string; name: string; date: string; time: string; type: string; sourceId: string };

export function parseBackupText(text: string) {
  const lines = text.split(/\r?\n/);
  const employees: ImportedEmployee[] = [];
  const punches: ImportedPunch[] = [];
  let current: ImportedEmployee | null = null;
  let employeeHeaders = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    const details = line.match(/^Nome:\s*(.*?)\s+CPF:\s*(.*?)\s+Matrícula:\s*(\S+)/);
    if (details) {
      const cargo = lines[i + 1]?.match(/^Cargo:\s*(.*?)\s+Depto:/);
      const depto = lines[i + 1]?.match(/Depto:\s*(.*?)\s+Unidade:/);
      current = { employeeNumber: details[3].trim(), name: details[1].trim(), jobTitle: cargo?.[1]?.trim() || undefined, department: depto?.[1]?.trim() || undefined };
      employees.push(current);
      employeeHeaders += 1;
      continue;
    }
    if (!current) continue;
    const day = line.match(/^(\d{2})\/(\d{2})\s+\S+/);
    if (!day || line.includes('Totais:')) continue;
    const scheduleEnd = line.indexOf(')');
    const folgaEnd = line.indexOf('Folga');
    const punchStart = scheduleEnd >= 0 ? scheduleEnd + 1 : folgaEnd >= 0 ? folgaEnd + 'Folga'.length : -1;
    if (punchStart < 0) continue;
    const punchSection = line.slice(punchStart);
    const calculatedHoursStart = punchSection.search(/\s{3,}\d{2}:\d{2}:\d{2}/);
    const punchText = calculatedHoursStart >= 0 ? punchSection.slice(0, calculatedHoursStart) : punchSection;
    const times = punchText.match(/\b\d{2}:\d{2}(?::\d{2})?\b/g) ?? [];
    times.slice(0, 4).forEach((time, index) => punches.push({ employeeNumber: current!.employeeNumber, name: current!.name, date: `2026-${day[2]}-${day[1]}`, time: time.length === 5 ? `${time}:00` : time, type: ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'][index], sourceId: `pdf-${current!.employeeNumber}-${day[2]}-${day[1]}-${time}-${index}` }));
  }

  const uniqueEmployees = [...new Map(employees.map((employee) => [employee.employeeNumber.replace(/\D/g, '').padStart(4, '0'), { ...employee, employeeNumber: employee.employeeNumber.replace(/\D/g, '').padStart(4, '0') }])).values()];
  const uniquePunches = [...new Map(punches.map((punch) => [punch.sourceId, punch])).values()];
  return { employeeHeaders, employees: uniqueEmployees, punches: uniquePunches, pagesDetected: Math.max(1, (text.match(/\f/g) || []).length + 1) };
}
