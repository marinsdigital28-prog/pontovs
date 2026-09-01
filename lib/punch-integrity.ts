export type PunchTimingInput = {
  origin: 'WEB' | 'OFFLINE' | 'ADJUSTED';
  clientTimestamp?: string | null;
  now?: Date;
};

export function resolvePunchTiming({ origin, clientTimestamp, now = new Date() }: PunchTimingInput) {
  const receivedAt = new Date(now);
  if (origin === 'OFFLINE' && !clientTimestamp) throw new Error('Marcação offline sem horário original.');
  const markedAt = origin === 'OFFLINE' && clientTimestamp ? new Date(clientTimestamp) : receivedAt;
  if (Number.isNaN(markedAt.getTime())) throw new Error('Horário original inválido.');
  return { markedAt, syncedAt: receivedAt, syncStatus: 'SYNCED' as const };
}

export function secondsBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

export function formatOfflineDuration(start: Date, end: Date) {
  const seconds = secondsBetween(start, end);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days} dia(s), ${hours} hora(s), ${minutes} minuto(s) e ${remainingSeconds} segundo(s)`;
}

export type LocationStatus = 'WITHIN_RADIUS' | 'OUTSIDE_RADIUS' | 'LOW_ACCURACY' | 'LOCATION_ONLY' | 'UNAVAILABLE';

export function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadius = 6371000;
  const latitudeDelta = (to.lat - from.lat) * Math.PI / 180;
  const longitudeDelta = (to.lng - from.lng) * Math.PI / 180;
  const latitudeA = from.lat * Math.PI / 180;
  const latitudeB = to.lat * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function evaluateLocation(input: { latitude: number | null; longitude: number | null; accuracy: number | null; companyLatitude: number | null; companyLongitude: number | null; radiusMeters: number }) {
  if (input.latitude === null || input.longitude === null) return { status: 'UNAVAILABLE' as const, distanceMeters: null };
  if (input.companyLatitude === null || input.companyLongitude === null) return { status: 'LOCATION_ONLY' as const, distanceMeters: null };
  const distance = distanceMeters({ lat: input.latitude, lng: input.longitude }, { lat: input.companyLatitude, lng: input.companyLongitude });
  if (input.accuracy !== null && input.accuracy > Math.max(100, input.radiusMeters)) return { status: 'LOW_ACCURACY' as const, distanceMeters: distance };
  return { status: distance <= input.radiusMeters ? 'WITHIN_RADIUS' as const : 'OUTSIDE_RADIUS' as const, distanceMeters: distance };
}
