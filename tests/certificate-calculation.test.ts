import { describe, expect, it } from 'vitest';
import { certificateMinutesForDay, formatCertificateDuration, minutesBetweenClocks, sumCertificateMinutesForDay } from '../lib/certificate-calculation';

describe('cálculo de atestados', () => {
  it('calcula 02h30 e rejeita duração negativa', () => {
    expect(minutesBetweenClocks('14:00', '16:30')).toBe(150);
    expect(formatCertificateDuration(150)).toBe('02h30');
    expect(minutesBetweenClocks('16:30', '14:00')).toBe(-150);
  });

  it('abona somente o intervalo por horas, descontando almoço quando atravessado', () => {
    const item = { type: 'HORAS', coverageType: 'HOURS', startDate: '2026-08-31', endDate: '2026-08-31', eventDate: '2026-08-31', startTime: '11:30', endTime: '14:30', durationMinutes: 180, status: 'APROVADO' };
    expect(certificateMinutesForDay(item, '2026-08-31', 8 * 60, 17 * 60, true, 480)).toBe(120);
  });

  it('soma vários atestados por horas sem converter o resultado em dias', () => {
    const items = [
      { type: 'HORAS', coverageType: 'HOURS', startDate: '2026-08-31', endDate: '2026-08-31', eventDate: '2026-08-31', startTime: '14:00', endTime: '16:00', durationMinutes: 120, status: 'APROVADO' },
      { type: 'HORAS', coverageType: 'HOURS', startDate: '2026-08-31', endDate: '2026-08-31', eventDate: '2026-08-31', startTime: '16:15', endTime: '17:45', durationMinutes: 90, status: 'APROVADO' },
    ];
    expect(sumCertificateMinutesForDay(items, '2026-08-31', 8 * 60, 18 * 60, false, 540)).toBe(210);
    expect(formatCertificateDuration(210)).toBe('03h30');
  });

  it('trata atestado por dias como cobertura da jornada prevista e não como horas', () => {
    const item = { type: 'PERIODO_DIAS', coverageType: 'DAYS', startDate: '2026-09-01', endDate: '2026-09-03', status: 'APROVADO' };
    expect(certificateMinutesForDay(item, '2026-09-02', 8 * 60, 17 * 60, true, 480)).toBe(480);
    expect(certificateMinutesForDay(item, '2026-09-04', 8 * 60, 17 * 60, true, 480)).toBe(0);
  });
});
