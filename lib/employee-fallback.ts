import employees from '../imports/employees-from-pdf.json';

type ImportedEmployee = {
  name?: string;
  employeeNumber?: string;
  jobTitle?: string;
};

function toFallbackEmployee(employee: ImportedEmployee) {
  if (!employee.name || !employee.employeeNumber || employee.employeeNumber === '0000') return null;
  return {
    id: `offline-${employee.employeeNumber}`,
    name: employee.name,
    employeeNumber: employee.employeeNumber,
    email: '',
    role: 'EMPLOYEE',
    jobTitle: employee.jobTitle ?? null,
    cpf: null,
    workDays: null,
    scheduleStart: null,
    scheduleEnd: null,
    scheduleByDay: null,
    active: true,
    punches: [],
  };
}

export function findEmployeeFallback(employeeNumber: string) {
  const normalized = employeeNumber.replace(/\D/g, '').padStart(4, '0');
  const employee = (employees as ImportedEmployee[]).find((item) => item.employeeNumber === normalized);
  return employee ? toFallbackEmployee(employee) : null;
}

export function listEmployeeFallbacks() {
  return (employees as ImportedEmployee[])
    .map(toFallbackEmployee)
    .filter((employee): employee is NonNullable<ReturnType<typeof toFallbackEmployee>> => Boolean(employee));
}
