import employees from '../imports/employees-from-pdf.json';

type ImportedEmployee = {
  name?: string;
  employeeNumber?: string;
  jobTitle?: string;
};

export function findEmployeeFallback(employeeNumber: string) {
  const normalized = employeeNumber.replace(/\D/g, '').padStart(4, '0');
  const employee = (employees as ImportedEmployee[]).find((item) => item.employeeNumber === normalized && normalized !== '0000');
  if (!employee?.name || !employee.employeeNumber) return null;

  return {
    id: `offline-${normalized}`,
    name: employee.name,
    employeeNumber: normalized,
    email: '',
    role: 'EMPLOYEE',
    jobTitle: employee.jobTitle ?? null,
    workDays: null,
    scheduleStart: null,
    scheduleEnd: null,
    scheduleByDay: null,
    active: true,
    punches: [],
  };
}
