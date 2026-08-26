import fs from 'node:fs';

const input = fs.readFileSync(new URL('./Backup_Ponto_2026-08-26.txt', import.meta.url), 'utf8');
const lines = input.split(/\r?\n/);
const employees = JSON.parse(fs.readFileSync(new URL('./employees-from-pdf.json', import.meta.url), 'utf8'));
const byNumber = new Map(employees.map((employee) => [employee.employeeNumber, employee]));
const rows = [];
let current = null;
for (const line of lines) {
  const header = line.match(/^Nome:\s*(.*?)\s+CPF:.*?Matrícula:\s*(\S+)/);
  if (header) {
    current = { employeeNumber: header[2], name: header[1].trim() };
    continue;
  }
  const day = line.match(/^(\d{2})\/(\d{2})\s+\S+/);
  if (!current || !day || line.includes('Totais:')) continue;
  const scheduleEnd = line.indexOf(')');
  if (scheduleEnd < 0) continue;
  const punchSection = line.slice(scheduleEnd + 1);
  const calculatedHoursStart = punchSection.search(/\s{3,}\d{2}:\d{2}:\d{2}/);
  const punchText = calculatedHoursStart >= 0 ? punchSection.slice(0, calculatedHoursStart) : punchSection;
  const punches = punchText.match(/\b\d{2}:\d{2}\b/g) ?? [];
  for (const [index, time] of punches.entries()) {
    rows.push({
      employeeNumber: current.employeeNumber,
      name: current.name,
      date: `2026-${day[2]}-${day[1]}`,
      time: time.length === 5 ? `${time}:00` : time,
      type: ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'][index] ?? 'EXTRA',
    });
  }
}
const unknownEmployees = [...new Set(rows.filter((row) => !byNumber.has(row.employeeNumber)).map((row) => row.employeeNumber))];
const counts = Object.fromEntries([...new Set(rows.map((row) => row.employeeNumber))].sort().map((number) => [number, rows.filter((row) => row.employeeNumber === number).length]));
const result = { totalPunches: rows.length, employeesWithPunches: Object.keys(counts).length, unknownEmployees, counts, rows };
fs.writeFileSync(new URL('./punches-from-pdf.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ totalPunches: result.totalPunches, employeesWithPunches: result.employeesWithPunches, unknownEmployees, counts }, null, 2));
