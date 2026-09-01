import { brazilDateKey } from './brazil-time';

export type PunchType = 'ENTRADA' | 'INTERVALO' | 'RETORNO' | 'SAIDA';
export type PunchMode = 'FULL' | 'HALF';

export const FULL_ORDER: readonly PunchType[] = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
export const HALF_ORDER: readonly PunchType[] = ['ENTRADA', 'SAIDA'];

const TYPE_LABELS: Record<PunchType, string> = {
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
};

export function punchTypeLabel(type: string) {
  return TYPE_LABELS[type as PunchType] || type;
}

function orderForMode(mode: PunchMode): readonly PunchType[] {
  return mode === 'HALF' ? HALF_ORDER : FULL_ORDER;
}

/** Minutos desde meia-noite no fuso America/Sao_Paulo */
export function brazilMinutesOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour === '24' ? '0' : values.hour);
  const minute = Number(values.minute);
  return hour * 60 + minute;
}

function parseHm(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export type TodayPunch = { type: string; timestamp: Date | string };

export type SmartPunchSuggestion = {
  sequentialType: PunchType | null;
  suggestedType: PunchType | null;
  allowedTypes: PunchType[];
  reason: string;
  journeyClosed: boolean;
  requiresConfirmationOutsideSuggestion: boolean;
};

/**
 * Decide o próximo tipo de ponto com base na sequência do dia e no horário atual.
 * A sequência continua sendo a base; o horário só “desvia” quando o contexto operacional é claro
 * (ex.: fim de expediente com intervalo sem retorno → sugere SAÍDA).
 */
export function resolveSmartPunchSuggestion(input: {
  punchesToday: TodayPunch[];
  mode?: PunchMode | null;
  scheduleEnd?: string | null;
  now?: Date;
}): SmartPunchSuggestion {
  const now = input.now ?? new Date();
  const mode: PunchMode = input.mode === 'HALF' ? 'HALF' : 'FULL';
  const order = orderForMode(mode);
  const minutes = brazilMinutesOfDay(now);
  const endMinutes = parseHm(input.scheduleEnd) ?? (mode === 'HALF' ? 12 * 60 : 17 * 60);
  const nearExit = minutes >= endMinutes - 45;
  const afternoon = minutes >= 15 * 60; // 15:00
  const lunchWindow = minutes >= 11 * 60 + 30 && minutes < 14 * 60 + 30;

  const sorted = [...input.punchesToday].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const typesDone = sorted.map((punch) => punch.type);
  const last = typesDone.length ? typesDone[typesDone.length - 1] : null;
  const lastIndex = last ? order.indexOf(last as PunchType) : -1;

  let sequentialType: PunchType | null =
    lastIndex >= 0 && lastIndex < order.length - 1
      ? order[lastIndex + 1]
      : lastIndex === order.length - 1
        ? null
        : order[0];

  // Já fechou a jornada na sequência linear
  if (sequentialType === null && lastIndex === order.length - 1) {
    return {
      sequentialType: null,
      suggestedType: null,
      allowedTypes: [],
      reason: 'Jornada de hoje já foi encerrada.',
      journeyClosed: true,
      requiresConfirmationOutsideSuggestion: true,
    };
  }

  let suggestedType: PunchType | null = sequentialType;
  let reason = sequentialType
    ? `Próximo na sequência: ${punchTypeLabel(sequentialType)}.`
    : 'Nenhuma marcação pendente.';

  // FULL: intervalo aberto e já é fim de expediente → saída faz mais sentido que retorno fantasma
  if (
    mode === 'FULL' &&
    last === 'INTERVALO' &&
    (nearExit || afternoon) &&
    !typesDone.includes('RETORNO') &&
    !typesDone.includes('SAIDA')
  ) {
    suggestedType = 'SAIDA';
    reason = nearExit
      ? 'Pelo horário de saída da jornada, o mais provável é Saída (intervalo sem retorno registrado).'
      : 'Já é fim de tarde e há intervalo aberto — recomendamos Saída.';
  }

  // FULL: tem entrada, ainda não intervalo, e está na janela de almoço
  if (
    mode === 'FULL' &&
    typesDone.includes('ENTRADA') &&
    !typesDone.includes('INTERVALO') &&
    lunchWindow &&
    sequentialType === 'INTERVALO'
  ) {
    suggestedType = 'INTERVALO';
    reason = 'Horário típico de almoço — recomendamos Intervalo.';
  }

  // Sem marcações e já passou bastante da manhã
  if (!typesDone.length && sequentialType === 'ENTRADA' && minutes >= 11 * 60) {
    suggestedType = 'ENTRADA';
    reason = 'Ainda não há ponto hoje. Recomendamos Entrada (mesmo com horário mais tarde).';
  }

  // HALF: só entrada/saída; perto do fim sugere saída se já entrou
  if (mode === 'HALF' && last === 'ENTRADA' && (nearExit || afternoon)) {
    suggestedType = 'SAIDA';
    reason = 'Meio expediente: pelo horário, o mais provável é Saída.';
  }

  // Opções: tipos da jornada que ainda fazem sentido operacionalmente.
  // Sempre inclui a sugestão e o próximo sequencial; permite correção sem liberar caos total.
  const allowed = new Set<PunchType>();
  if (suggestedType) allowed.add(suggestedType);
  if (sequentialType) allowed.add(sequentialType);

  for (const type of order) {
    // ainda não batido, ou repetição controlada só do próximo lógico
    if (!typesDone.includes(type)) allowed.add(type);
  }

  // Se já tem SAIDA, não oferece mais nada
  if (typesDone.includes('SAIDA') || (mode === 'HALF' && last === 'SAIDA')) {
    return {
      sequentialType: null,
      suggestedType: null,
      allowedTypes: [],
      reason: 'Jornada de hoje já foi encerrada.',
      journeyClosed: true,
      requiresConfirmationOutsideSuggestion: true,
    };
  }

  // Garante ordem estável na UI
  const allowedTypes = order.filter((type) => allowed.has(type));

  return {
    sequentialType,
    suggestedType,
    allowedTypes: allowedTypes.length ? allowedTypes : sequentialType ? [sequentialType] : [],
    reason,
    journeyClosed: !suggestedType && !sequentialType,
    requiresConfirmationOutsideSuggestion: true,
  };
}

export function isAllowedPunchType(type: string, allowed: PunchType[]) {
  return allowed.includes(type as PunchType);
}

/** Converte ISO → valor datetime-local em America/Sao_Paulo */
export function toBrazilDatetimeLocalValue(iso: string | Date) {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = v.hour === '24' ? '00' : v.hour;
  return `${v.year}-${v.month}-${v.day}T${hour}:${v.minute}`;
}

/** Interpreta datetime-local digitado como horário de Brasília e devolve Date */
export function fromBrazilDatetimeLocalValue(value: string) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null;
  const withSeconds = text.length === 16 ? `${text}:00` : text;
  const date = new Date(`${withSeconds}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBrazilTime(iso: string | Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export { brazilDateKey };
