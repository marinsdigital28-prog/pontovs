import fs from 'node:fs';

const input = fs.readFileSync(new URL('./Backup_Ponto_2026-08-26.txt', import.meta.url), 'utf8');
const lines = input.split(/\r?\n/);
const employees = [];
for (let i = 0; i < lines.length; i += 1) {
  const name = lines[i].match(/^Nome:\s*(.*?)\s+CPF:/);
  if (!name) continue;
  const details = lines[i].match(/^Nome:\s*(.*?)\s+CPF:\s*(.*?)\s+Matrícula:\s*(\S+)/);
  const cargo = lines[i + 1]?.match(/^Cargo:\s*(.*?)\s+Depto:/);
  const depto = lines[i + 1]?.match(/Depto:\s*(.*?)\s+Unidade:/);
  const escala = lines[i + 2]?.match(/^Escala:\s*(.*?)\s+Base de Horas:/);
  const jornada = lines[i + 2]?.match(/Jornada:\s*(.*?)\s*$/);
  if (details) employees.push({
    name: details[1].trim(), cpf: details[2].trim(), employeeNumber: details[3].trim(),
    jobTitle: cargo?.[1]?.trim() ?? '', department: depto?.[1]?.trim() ?? '',
    schedule: escala?.[1]?.trim() ?? '', jornada: jornada?.[1]?.trim() ?? '',
  });
}
const unique = [...new Map(employees.map((item) => [item.employeeNumber, item])).values()];
fs.writeFileSync(new URL('./employees-from-pdf.json', import.meta.url), JSON.stringify(unique, null, 2) + '\n');
console.log(JSON.stringify({ totalHeaders: employees.length, uniqueEmployees: unique.length, employees: unique }, null, 2));
