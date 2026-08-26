export const UNITS = ['Espaço Educacional Progredir', 'Espaço Progredir'] as const;
export const WEEK_DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const;

export function digits(value: string) { return value.replace(/\D/g, ''); }

export function normalizeCpf(value: string) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^([0-9])\1{10}$/.test(cpf)) return null;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(cpf[index]) * (10 - index);
  let check = (sum * 10) % 11; if (check === 10) check = 0;
  if (check !== Number(cpf[9])) return null;
  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(cpf[index]) * (11 - index);
  check = (sum * 10) % 11; if (check === 10) check = 0;
  return check === Number(cpf[10]) ? cpf : null;
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

export function normalizePhone(value: string) {
  const phone = digits(value);
  return phone.length >= 10 && phone.length <= 13 ? phone : null;
}

export function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const now = new Date();
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= now;
}

export function validTimeRange(start: string, end: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) && start < end;
}

export function validWorkDays(value: string) {
  let raw = value;
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) raw = parsed.join(','); } catch { /* formato textual legado */ }
  const selected = raw.split(',').map(day => day.trim().toUpperCase()).filter(Boolean);
  return selected.length > 0 && selected.every(day => WEEK_DAYS.includes(day as typeof WEEK_DAYS[number]));
}

export type ProfileValues = { cpf: string; birthDate: string; jobTitle: string; unit: string; workDays: string; scheduleStart: string; scheduleEnd: string; whatsapp: string; email: string };

export type AdminEmployeeValues = { name: string; employeeNumber: string; cpf?: string; jobTitle?: string; workDays?: string; scheduleStart?: string; scheduleEnd?: string };

export function validateAdminEmployee(values: AdminEmployeeValues) {
  const errors: Partial<Record<keyof AdminEmployeeValues, string>> = {};
  if (values.name.trim().length < 3) errors.name = 'Informe o nome completo.';
  const number = digits(values.employeeNumber);
  if (!number || number === '0000' || number.length > 12) errors.employeeNumber = 'Informe uma matrícula válida.';
  if (values.cpf?.trim() && !normalizeCpf(values.cpf)) errors.cpf = 'Informe um CPF válido.';
  if (values.jobTitle?.trim() && values.jobTitle.trim().length < 2) errors.jobTitle = 'Informe um cargo válido.';
  if (values.workDays?.trim() && !validWorkDays(values.workDays)) errors.workDays = 'Informe dias válidos, como SEG,TER,QUA.';
  if ((values.scheduleStart || values.scheduleEnd) && (!values.scheduleStart || !values.scheduleEnd || !validTimeRange(values.scheduleStart, values.scheduleEnd))) errors.scheduleEnd = 'Informe uma jornada válida; o horário final deve ser posterior ao inicial.';
  return errors;
}

export function validateProfile(values: ProfileValues) {
  const errors: Partial<Record<keyof ProfileValues, string>> = {};
  if (!normalizeCpf(values.cpf)) errors.cpf = 'Informe um CPF válido.';
  if (!validBirthDate(values.birthDate)) errors.birthDate = 'Informe uma data de nascimento válida e não futura.';
  if (values.jobTitle.trim().length < 2) errors.jobTitle = 'Informe o cargo.';
  if (!UNITS.includes(values.unit as typeof UNITS[number])) errors.unit = 'Selecione uma unidade válida.';
  if (!validWorkDays(values.workDays)) errors.workDays = 'Informe dias válidos, como SEG,TER,QUA.';
  if (!validTimeRange(values.scheduleStart, values.scheduleEnd)) errors.scheduleEnd = 'O horário final deve ser posterior ao inicial.';
  if (!normalizePhone(values.whatsapp)) errors.whatsapp = 'Informe um WhatsApp válido.';
  if (!normalizeEmail(values.email)) errors.email = 'Informe um e-mail válido.';
  return errors;
}
