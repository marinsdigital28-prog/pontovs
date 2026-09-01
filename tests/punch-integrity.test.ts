import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateLocation, formatOfflineDuration, resolvePunchTiming } from '../lib/punch-integrity';

describe('integridade de marcação', () => {
  it('preserva marked_at e separa synced_at em sincronização offline', () => {
    const result = resolvePunchTiming({ origin: 'OFFLINE', clientTimestamp: '2026-08-28T20:58:32.000Z', now: new Date('2026-08-31T11:12:44.000Z') });
    expect(result.markedAt.toISOString()).toBe('2026-08-28T20:58:32.000Z');
    expect(result.syncedAt.toISOString()).toBe('2026-08-31T11:12:44.000Z');
    expect(result.syncStatus).toBe('SYNCED');
    expect(formatOfflineDuration(result.markedAt, result.syncedAt)).toBe('2 dia(s), 14 hora(s), 14 minuto(s) e 12 segundo(s)');
  });

  it('não aceita registro offline sem horário original', () => {
    expect(() => resolvePunchTiming({ origin: 'OFFLINE', clientTimestamp: null, now: new Date('2026-08-31T11:12:44.000Z') })).toThrow('horário original');
  });

  it('calcula distância e distingue dentro, fora e precisão baixa', () => {
    expect(distanceMeters({ lat: -23.5505, lng: -46.6333 }, { lat: -23.5505, lng: -46.6333 })).toBe(0);
    expect(evaluateLocation({ latitude: -23.5505, longitude: -46.6333, accuracy: 5, companyLatitude: -23.5505, companyLongitude: -46.6333, radiusMeters: 150 }).status).toBe('WITHIN_RADIUS');
    expect(evaluateLocation({ latitude: -23.55, longitude: -46.63, accuracy: 5, companyLatitude: -23.5505, companyLongitude: -46.6333, radiusMeters: 150 }).status).toBe('OUTSIDE_RADIUS');
    expect(evaluateLocation({ latitude: -23.5505, longitude: -46.6333, accuracy: 500, companyLatitude: -23.5505, companyLongitude: -46.6333, radiusMeters: 150 }).status).toBe('LOW_ACCURACY');
  });

  it('informa localização apenas quando as coordenadas existem, sem forçar local empresarial', () => {
    expect(evaluateLocation({ latitude: -23.5505, longitude: -46.6333, accuracy: null, companyLatitude: null, companyLongitude: null, radiusMeters: 150 })).toEqual({ status: 'LOCATION_ONLY', distanceMeters: null });
    expect(evaluateLocation({ latitude: null, longitude: null, accuracy: null, companyLatitude: -23.5505, companyLongitude: -46.6333, radiusMeters: 150 })).toEqual({ status: 'UNAVAILABLE', distanceMeters: null });
  });
});
