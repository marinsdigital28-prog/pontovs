import employees from '../imports/employees-from-pdf.json' with { type: 'json' };
const fields = ['jobTitle', 'schedule', 'jornada'];
const missing = Object.fromEntries(fields.map((field) => [field, employees.filter((employee) => !String(employee[field] ?? '').trim()).map((employee) => employee.employeeNumber)]));
console.log(JSON.stringify({ total: employees.length, missing, sample: employees.slice(0, 3) }, null, 2));
