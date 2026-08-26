import { describe, expect, it } from 'vitest';
import { normalizeCpf, normalizeEmail, normalizePhone, validBirthDate, validTimeRange, validWorkDays, validateProfile } from '../lib/employee-validation';

describe('validação de cadastro do colaborador', () => {
  it('valida e normaliza CPF', () => { expect(normalizeCpf('529.982.247-25')).toBe('52998224725'); expect(normalizeCpf('111.111.111-11')).toBeNull(); });
  it('valida contatos e data', () => { expect(normalizeEmail('  Pessoa@Email.COM ')).toBe('pessoa@email.com'); expect(normalizePhone('(11) 99999-9999')).toBe('11999999999'); expect(validBirthDate('1990-05-20')).toBe(true); expect(validBirthDate('2099-01-01')).toBe(false); });
  it('valida dias e intervalo de jornada', () => { expect(validWorkDays('SEG, TER, QUA')).toBe(true); expect(validWorkDays('SEG,FUNDAY')).toBe(false); expect(validTimeRange('08:00', '17:00')).toBe(true); expect(validTimeRange('17:00', '08:00')).toBe(false); });
  it('retorna erros para perfil incompleto', () => { const errors = validateProfile({ cpf: '123', birthDate: '2099-01-01', jobTitle: '', unit: '', workDays: '', scheduleStart: '17:00', scheduleEnd: '08:00', whatsapp: 'x', email: 'x' }); expect(Object.keys(errors)).toEqual(expect.arrayContaining(['cpf', 'birthDate', 'jobTitle', 'unit', 'workDays', 'scheduleEnd', 'whatsapp', 'email'])); });
});
