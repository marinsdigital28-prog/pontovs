import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const employees = JSON.parse(fs.readFileSync(new URL('../imports/employees-from-pdf.json', import.meta.url), 'utf8'))
    .filter((employee) => employee.employeeNumber !== '0000');
  const current = await prisma.user.findMany({
    where: { role: 'EMPLOYEE' },
    select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, active: true },
    orderBy: { employeeNumber: 'asc' },
  });
  const byNumber = new Map(current.filter((row) => row.employeeNumber).map((row) => [row.employeeNumber, row]));
  const pdfNumbers = new Set(employees.map((row) => row.employeeNumber));
  const missingInDb = employees.filter((row) => !byNumber.has(row.employeeNumber)).map((row) => row.employeeNumber);
  const missingInPdf = current.filter((row) => row.employeeNumber && !pdfNumbers.has(row.employeeNumber)).map((row) => row.employeeNumber);
  const jobTitleMissing = current.filter((row) => row.employeeNumber && (!row.jobTitle || !row.jobTitle.trim())).map((row) => row.employeeNumber);
  const report = { pdfEmployees: employees.length, dbEmployees: current.length, missingInDb, missingInPdf, jobTitleMissing, current };
  fs.writeFileSync(new URL('../imports/db-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pdfEmployees: report.pdfEmployees, dbEmployees: report.dbEmployees, missingInDb, missingInPdf, jobTitleMissing, records: await prisma.punch.count() }, null, 2));
} finally {
  await prisma.$disconnect();
}
