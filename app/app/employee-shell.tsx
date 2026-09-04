'use client';

import './emp-app.css';
import './emp-radar.css';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

type Punch = { id: string; type: string; timestamp: string; status: string; photoData?: string | null; hasPhoto?: boolean };
type EmpProfile = {
  phone?: string; personalEmail?: string; address?: string; number?: string; complement?: string; neighborhood?: string;
  city?: string; uf?: string; cep?: string; pis?: string; rg?: string; birthDate?: string; sex?: string; maritalStatus?: string;
  admissionDate?: string; department?: string; ctps?: string; ctpsSeries?: string; motherName?: string; fatherName?: string;
  remuneration?: string; jobTitleFromPdf?: string; [key: string]: string | undefined;
};
type EmployeeData = {
  employee: {
    id: string; name: string; employeeNumber: string | null; cpf?: string | null; jobTitle: string | null;
    scheduleStart: string | null; scheduleEnd: string | null; workDays: string | null;
    scheduleByDay?: Record<string, { start?: string; end?: string; mode?: string }> | null;
    profile?: EmpProfile | null; active?: boolean; unitName?: string | null;
  };
  punches: Punch[];
};
type RequestItem = { id: string; type: string; status: string; startDate: string; endDate: string; reason: string; details?: string | null; reviewNote?: string | null; createdAt: string };

const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Intervalo', RETORNO: 'Retorno', SAIDA: 'Saída' };
const ABSENCE_REASONS = [
  'Consulta médica', 'Exame médico', 'Atestado / problema de saúde', 'Compromisso pessoal', 'Problema familiar',
  'Passeio / evento externo', 'Evento ou atividade externa', 'Curso / treinamento', 'Audiência / cartório / banco',
  'Imprevisto no trajeto / transporte', 'Acompanhamento de familiar', 'Outros',
] as const;
const COVERAGE_OPTIONS = [
  { value: 'PARCIAL_MANHA', label: 'Parcial — manhã' },
  { value: 'PARCIAL_TARDE', label: 'Parcial — tarde' },
  { value: 'DIA_INTEIRO', label: 'Dia inteiro' },
  { value: 'EMERGENCIA', label: 'Emergência (sem aviso prévio)' },
] as const;
const COVERAGE_LABEL: Record<string, string> = {
  PARCIAL_MANHA: 'Parcial manhã', PARCIAL_TARDE: 'Parcial tarde', DIA_INTEIRO: 'Dia inteiro', EMERGENCIA: 'Emergência',
};
const FORGOT_TYPES = [
  { value: 'ENTRADA', label: 'Entrada' }, { value: 'INTERVALO', label: 'Intervalo' },
  { value: 'RETORNO', label: 'Retorno' }, { value: 'SAIDA', label: 'Saída' },
] as const;
const FORGOT_REASONS = [
  'Esqueci de bater no totem', 'Totem indisponível / com problema', 'Estava em atendimento / reunião',
  'Cheguei e fui direto à atividade', 'Saí com urgência e não consegui marcar', 'Outros',
] as const;

const APP_TZ = 'America/Sao_Paulo';
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
function padMat(v: string) { return v.replace(/\D/g, '').padStart(4, '0'); }
type Tab = 'home' | 'journey' | 'month' | 'absences' | 'profile';

export default function EmployeeAppPage() {
  const { status: sessionStatus } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [matricula, setMatricula] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<EmployeeData | null>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [requestKind, setRequestKind] = useState<'AUSENCIA' | 'ESQUECI_PONTO' | 'TROCA_DIA' | 'AVISO_ATRASO'>('AUSENCIA');
  const [remindersOn, setRemindersOn] = useState(false);
  const [absenceMode, setAbsenceMode] = useState<'HORAS' | 'DIAS'>('HORAS');
  const [forgotType, setForgotType] = useState<string>('ENTRADA');
  const [forgotReason, setForgotReason] = useState<string>('Esqueci de bater no totem');
  const [absenceMsg, setAbsenceMsg] = useState('');
  const [coverage, setCoverage] = useState<string>('DIA_INTEIRO');
  const [reasonChoice, setReasonChoice] = useState<string>(ABSENCE_REASONS[0]);
  const [whatsappText, setWhatsappText] = useState<string | null>(null);
  const [dismissInstall, setDismissInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [quickForgotLoading, setQuickForgotLoading] = useState(false);
  const [quickForgotDone, setQuickForgotDone] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosDone, setSosDone] = useState('');
  const knownPunchIds = useRef<Set<string>>(new Set());
  const firstLoadDone = useRef(false);
  const knownRequestStatus = useRef<Map<string, string>>(new Map());
  const requestsReady = useRef(false);

  function notifyPopup(title: string, body: string, tag?: string) {
    setToast(`${title}: ${body}`);
    window.setTimeout(() => setToast(null), 5000);
    try { if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 80]); } catch {}
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(title, { body, icon: '/ponto-progredir-icon-circular.png', badge: '/ponto-progredir-icon-circular.png', tag: tag || `aviso-${Date.now()}`, requireInteraction: true });
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission().then((p) => {
            if (p === 'granted') new Notification(title, { body, icon: '/ponto-progredir-icon-circular.png', tag: tag || `aviso-${Date.now()}`, requireInteraction: true });
          });
        }
      }
    } catch {}
  }

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/employee/history', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const punches: Punch[] = json.punches || [];
    if (firstLoadDone.current) {
      const newOnes = punches.filter((p) => !knownPunchIds.current.has(p.id));
      if (newOnes.length) {
        const latest = newOnes[0];
        const label = TYPE_LABEL[latest.type] || latest.type;
        const when = timeFmt.format(new Date(latest.timestamp));
        const msg = `${label} registrada às ${when}`;
        setToast(msg);
        try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch {}
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Ponto Progredir', { body: msg, icon: '/ponto-progredir-icon-circular.png', tag: `punch-${latest.id}` });
          }
        } catch {}
        window.setTimeout(() => setToast(null), 4500);
      }
    }
    knownPunchIds.current = new Set(punches.map((p) => p.id));
    firstLoadDone.current = true;
    setData({ employee: json.employee, punches });
  }, []);

  const loadRequests = useCallback(async () => {
    const res = await fetch('/api/employee/requests', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const list: RequestItem[] = json.requests || [];
    if (requestsReady.current) {
      for (const r of list) {
        const prev = knownRequestStatus.current.get(r.id);
        if (prev && prev !== r.status && (r.status === 'APROVADO' || r.status === 'REJEITADO')) {
          const tipo = r.type === 'AUSENCIA' ? 'Aviso de ausência' : r.type === 'ESQUECI_PONTO' ? 'Ponto esquecido' : r.type === 'AVISO_ATRASO' ? 'Aviso de atraso' : r.type === 'TROCA_DIA' ? 'Troca de dia' : 'Solicitação';
          const decision = r.status === 'APROVADO' ? 'aprovada ✅' : 'rejeitada ❌';
          const extra = r.reviewNote ? ` · ${r.reviewNote}` : '';
          notifyPopup('Espaço Progredir', `${tipo} ${decision}${extra}`, `req-${r.id}-${r.status}`);
        }
      }
    }
    knownRequestStatus.current = new Map(list.map((r) => [r.id, r.status]));
    requestsReady.current = true;
    setRequests(list);
  }, []);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    void loadHistory(); void loadRequests();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') { void loadHistory(); void loadRequests(); } }, 12000);
    return () => window.clearInterval(t);
  }, [sessionStatus, loadHistory, loadRequests]);

  useEffect(() => {
    if (!remindersOn || sessionStatus !== 'authenticated') return;
    const start = data?.employee?.scheduleStart;
    const end = data?.employee?.scheduleEnd;
    if (!start && !end) return;
    const timers: number[] = [];
    const scheduleAt = (hhmm: string, label: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return;
      const now = new Date();
      const target = new Date();
      target.setHours(h, m, 0, 0);
      target.setMinutes(target.getMinutes() - 10);
      const delay = target.getTime() - now.getTime();
      if (delay < 0) return;
      timers.push(window.setTimeout(() => notifyPopup('Lembrete de ponto', `${label} em cerca de 10 minutos`, `lembrete-${label}`), delay));
    };
    if (start) scheduleAt(start, 'Horário de entrada');
    if (end) scheduleAt(end, 'Horário de saída');
    return () => { timers.forEach((id) => window.clearTimeout(id)); };
  }, [remindersOn, sessionStatus, data?.employee?.scheduleStart, data?.employee?.scheduleEnd]);

  useEffect(() => {
    const nativeShell = new URLSearchParams(window.location.search).get('native') === '1' || /PontoProgredirNative|Capacitor/i.test(window.navigator.userAgent) || Boolean((window as Window & { Capacitor?: unknown }).Capacitor);
    const standalone = nativeShell || window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true || document.referrer.includes('android-app://');
    setIsStandalone(standalone);
    const onBip = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', onBip);
    const onInstalled = () => setIsStandalone(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBip); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === 'accepted') setIsStandalone(true);
    setInstallPrompt(null);
  }

  async function login(e: FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    const result = await signIn('credentials', { employeeNumber: padMat(matricula), redirect: false });
    if (result?.error) setError('Matrícula não encontrada ou inativa.');
    else {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
      await loadHistory(); await loadRequests();
      notifyPopup('Ponto Progredir', 'Login realizado. Notificações de avisos ativadas.', 'login-ok');
    }
    setLoading(false);
  }

  const todayKey = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  }, []);

  const todayPunches = useMemo(() => {
    if (!data?.punches) return [];
    return data.punches.filter((p) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(p.timestamp));
      const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      return `${v.year}-${v.month}-${v.day}` === todayKey;
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [data, todayKey]);


  const workDayInfo = useMemo(() => {
    const DAY_CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
    const wdLabel = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, weekday: 'short' }).format(new Date());
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = map[wdLabel] ?? new Date().getDay();
    const dayCode = DAY_CODES[weekday];
    const workDaysRaw = String(data?.employee?.workDays || '').toUpperCase().replace(/Á/g, 'A');
    const byDay = data?.employee?.scheduleByDay as Record<string, unknown> | null | undefined;
    let hasOverride = false;
    if (byDay && typeof byDay === 'object') {
      const key = Object.keys(byDay).find((k) => String(k).toUpperCase().replace(/Á/g, 'A') === dayCode);
      if (key) hasOverride = true;
    }
    let worksToday = true;
    if (hasOverride) worksToday = true;
    else if (workDaysRaw) {
      if (workDaysRaw.trim().startsWith('[')) {
        try {
          const arr = JSON.parse(String(data?.employee?.workDays || '[]')) as string[];
          worksToday = arr.map((x) => String(x).toUpperCase().replace(/Á/g, 'A')).includes(dayCode);
        } catch { worksToday = workDaysRaw.includes(dayCode); }
      } else worksToday = workDaysRaw.includes(dayCode);
    } else worksToday = weekday >= 1 && weekday <= 5;
    return {
      worksToday,
      dayCode,
      message: worksToday ? null : ((weekday === 0 || weekday === 6)
        ? 'Hoje é sua folga. Sem expediente.'
        : 'Hoje não tem expediente na sua escala.'),
    };
  }, [data?.employee?.workDays, data?.employee?.scheduleByDay]);

  const missingPunchHint = useMemo(() => {
    if (workDayInfo && !workDayInfo.worksToday) return null as null | { type: string; label: string; message: string };
    const start = data?.employee?.scheduleStart;
    const end = data?.employee?.scheduleEnd;
    if (!start && !end) return null as null | { type: string; label: string; message: string };
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const hv = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const nowMin = Number(hv.hour) * 60 + Number(hv.minute);
    const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return null; return h * 60 + m; };
    const types = new Set(todayPunches.map((p) => p.type));
    const startMin = start ? toMin(start) : null;
    const endMin = end ? toMin(end) : null;
    if (startMin !== null && nowMin >= startMin + 15 && !types.has('ENTRADA')) {
      return { type: 'ENTRADA', label: 'Entrada', message: `Não encontramos a marcação de entrada de hoje (prevista às ${start}).` };
    }
    if (endMin !== null && nowMin >= endMin + 15 && types.has('ENTRADA') && !types.has('SAIDA')) {
      return { type: 'SAIDA', label: 'Saída', message: `Não encontramos a marcação de saída de hoje (prevista às ${end}).` };
    }
    if (startMin !== null && nowMin >= startMin + 60 && todayPunches.length === 0) {
      return { type: 'ENTRADA', label: 'Entrada', message: 'Ainda não há marcações registradas hoje no sistema.' };
    }
    return null;
  }, [data?.employee?.scheduleStart, data?.employee?.scheduleEnd, todayPunches]);

  const journeyRadar = useMemo(() => {
    const start = data?.employee?.scheduleStart;
    const end = data?.employee?.scheduleEnd;
    const types = new Set(todayPunches.map((p) => p.type));
    const last = todayPunches[todayPunches.length - 1];
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const hv = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const nowMin = Number(hv.hour) * 60 + Number(hv.minute);
    const toMin = (hhmm) => {
      if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const startMin = toMin(start);
    const endMin = toMin(end);
    let title = 'Sem jornada cadastrada';
    let detail = 'Peça à ADM para conferir seu horário.';
    let nextExpected: string | null = null;
    let delayMin: number | null = null;
    let tone = 'neutral';
    if (workDayInfo && workDayInfo.worksToday === false) {
      return { title: 'Folga · sem expediente', detail: workDayInfo.message || 'Hoje não há expediente na sua escala.', nextExpected: null, delayMin: null, tone: 'neutral', typesCount: todayPunches.length, isOff: true };
    }
    if (types.has('SAIDA') && types.has('ENTRADA')) {
      title = 'Jornada completa';
      detail = 'Entrada e saída registradas hoje.';
      tone = 'ok';
    } else if (types.has('INTERVALO') && !types.has('RETORNO') && !types.has('SAIDA')) {
      title = 'Em intervalo';
      detail = last ? `Última batida: ${TYPE_LABEL[last.type] || last.type} às ${timeFmt.format(new Date(last.timestamp))}` : 'Intervalo em andamento.';
      nextExpected = 'Retorno do intervalo';
      tone = 'warn';
    } else if (types.has('ENTRADA') || types.has('RETORNO')) {
      if (endMin !== null && nowMin >= endMin + 10 && !types.has('SAIDA')) {
        title = 'Deveria ter saída';
        detail = `Horário de saída previsto: ${end}. Ainda sem batida de saída.`;
        nextExpected = `Saída (~${end})`;
        delayMin = nowMin - endMin;
        tone = 'alert';
      } else {
        title = 'Dentro da jornada';
        detail = last ? `Última: ${TYPE_LABEL[last.type] || last.type} · ${timeFmt.format(new Date(last.timestamp))}` : 'Em expediente.';
        nextExpected = end ? `Saída (~${end})` : null;
        tone = 'ok';
      }
    } else if (startMin !== null && nowMin >= startMin + 10) {
      title = 'Sem entrada registrada';
      detail = `Entrada prevista às ${start}. Ainda não há batida no sistema.`;
      nextExpected = `Entrada (~${start})`;
      delayMin = nowMin - startMin;
      tone = 'alert';
    } else if (startMin !== null) {
      title = 'Antes do expediente';
      detail = `Entrada prevista às ${start}.`;
      nextExpected = `Entrada (~${start})`;
      tone = 'neutral';
    }
    return { title, detail, nextExpected, delayMin, tone, typesCount: todayPunches.length };
  }, [data?.employee?.scheduleStart, data?.employee?.scheduleEnd, todayPunches]);

  async function quickForgot(type: string) {
    if (quickForgotLoading || quickForgotDone) return;
    setQuickForgotLoading(true); setError('');
    const nowParts = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const tv = Object.fromEntries(nowParts.map((p) => [p.type, p.value]));
    const approxTime = `${tv.hour}:${tv.minute}`;
    const reason = 'Esqueci de bater no totem';
    const details = `Batida esquecida: ${TYPE_LABEL[type] || type} · Horário aproximado: ${approxTime} · Aviso rápido pela tela inicial`;
    const response = await fetch('/api/employee/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ESQUECI_PONTO', startDate: todayKey, endDate: todayKey, reason, details, classification: type }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error || 'Não foi possível avisar a administração.');
      notifyPopup('Aviso', json.error || 'Falha ao enviar. Tente em Avisos.', 'quick-forgot-err');
    } else {
      setQuickForgotDone(true);
      notifyPopup('Esqueci de marcar', `${TYPE_LABEL[type] || type} enviado ao painel da ADM.`, 'quick-forgot-ok');
      await loadRequests();
    }
    setQuickForgotLoading(false);
  }

  async function sendSos(kind) {
    if (sosLoading || sosDone) return;
    setSosLoading(true); setError('');
    const nowParts = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const tv = Object.fromEntries(nowParts.map((p) => [p.type, p.value]));
    const approxTime = `${tv.hour}:${tv.minute}`;
    let payload;
    if (kind === 'HONESTY') {
      const missing = !todayPunches.some((p) => p.type === 'ENTRADA') ? 'ENTRADA' : !todayPunches.some((p) => p.type === 'SAIDA') ? 'SAIDA' : 'ENTRADA';
      payload = { type: 'ESQUECI_PONTO', startDate: todayKey, endDate: todayKey, reason: `Modo honestidade: o dia não ficou redondo (~${approxTime})`, details: `Radar: ${journeyRadar.title}. ${journeyRadar.detail}`, classification: missing };
    } else if (kind === 'ATRASO') {
      payload = { type: 'AVISO_ATRASO', startDate: todayKey, endDate: todayKey, reason: `Atraso no trajeto / imprevisto (~${approxTime})`, details: 'Enviado pelo SOS do app', classification: 'EMERGENCIA', returnExpected: true };
    } else if (kind === 'NAO_VENHO') {
      payload = { type: 'AUSENCIA', startDate: todayKey, endDate: todayKey, reason: 'Não poderei comparecer hoje', details: 'SOS app — emergência no dia', classification: 'EMERGENCIA', returnExpected: false };
    } else {
      payload = { type: 'AUSENCIA', startDate: todayKey, endDate: todayKey, reason: 'Atividade / evento externo', details: 'SOS app — em atividade externa', classification: 'EMERGENCIA', returnExpected: true };
    }
    try {
      const res = await fetch('/api/employee/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Não foi possível avisar a ADM.'); setSosLoading(false); return; }
      const labels = { HONESTY: 'Aviso de dia incompleto enviado', ATRASO: 'Aviso de atraso enviado', NAO_VENHO: 'Ausência enviada', EXTERNO: 'Atividade externa enviada' };
      setSosDone(labels[kind]);
      notifyPopup('Espaço Progredir', labels[kind], `sos-${kind}`);
      void loadRequests();
    } catch { setError('Falha de conexão ao avisar a ADM.'); }
    setSosLoading(false);
  }

  const lastPhoto = useMemo(() => {
    const withPhoto = [...todayPunches].reverse().find((p) => p.photoData);
    return withPhoto?.photoData || null;
  }, [todayPunches]);

  const punchesByDay = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const p of data?.punches ?? []) {
      const key = shortDate.format(new Date(p.timestamp));
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [data]);

  async function submitAbsence(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError(''); setWhatsappText(null);
    const form = new FormData(e.currentTarget);
    const file = form.get('document');
    const documentFile = file instanceof File && file.size > 0 ? file : null;
    let documentData: string | null = null;
    if (documentFile) {
      documentData = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(documentFile);
      });
    }
    const isHours = absenceMode === 'HORAS';
    const startDate = String(form.get('startDate') || '');
    const endDate = isHours ? startDate : String(form.get('endDate') || startDate);
    const startTime = isHours ? String(form.get('startTime') || '') : null;
    const endTime = isHours ? String(form.get('endTime') || '') : null;
    const returnTime = String(form.get('returnTime') || '') || null;
    const note = String(form.get('note') || '') || null;
    let finalCoverage = coverage;
    if (startDate === todayKey && finalCoverage !== 'EMERGENCIA') finalCoverage = 'EMERGENCIA';
    const reason = reasonChoice === 'Outros' ? (String(form.get('reasonOther') || '').trim() || 'Outros') : reasonChoice;
    const details = [`Tipo: ${COVERAGE_LABEL[finalCoverage] || finalCoverage}`, startTime && endTime ? `Horário: ${startTime}–${endTime}` : null, returnTime ? `Previsão de volta: ${returnTime}` : null, note].filter(Boolean).join(' · ');
    const response = await fetch('/api/employee/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'AUSENCIA', startDate, endDate, reason, details: details || null, classification: finalCoverage, returnExpected: Boolean(returnTime), documentName: documentFile?.name || null, documentMime: documentFile?.type || null, documentData }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar a solicitação.');
    else {
      const period = startDate === endDate ? shortDate.format(new Date(startDate + 'T12:00:00')) : `${shortDate.format(new Date(startDate + 'T12:00:00'))} até ${shortDate.format(new Date(endDate + 'T12:00:00'))}`;
      const timePart = startTime && endTime ? ` das ${startTime} às ${endTime}` : '';
      setWhatsappText(`🌿 *Espaço Progredir*\n*Aviso de ausência*\n────────────────\n👤 ${data?.employee?.name || ''}\n🔢 Mat. ${data?.employee?.employeeNumber || ''}\n📅 ${period}${timePart}\n📋 ${COVERAGE_LABEL[finalCoverage] || finalCoverage}\n💬 ${reason}`);
      setAbsenceMsg('Seu aviso de ausência foi registrado com sucesso.');
      notifyPopup('Aviso de ausência', 'Solicitação enviada. A ADM vai analisar.', 'aviso-ausencia');
      (e.target as HTMLFormElement).reset(); setReasonChoice(ABSENCE_REASONS[0]); setCoverage('DIA_INTEIRO');
      await loadRequests();
    }
    setLoading(false);
  }

  async function submitForgot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError(''); setWhatsappText(null);
    const form = new FormData(e.currentTarget);
    const day = String(form.get('forgotDate') || '');
    const approxTime = String(form.get('forgotTime') || '');
    const note = String(form.get('note') || '') || null;
    const reason = forgotReason === 'Outros' ? (String(form.get('reasonOther') || '').trim() || 'Outros') : forgotReason;
    const details = [`Batida esquecida: ${TYPE_LABEL[forgotType] || forgotType}`, approxTime ? `Horário aproximado: ${approxTime}` : null, note].filter(Boolean).join(' · ');
    const response = await fetch('/api/employee/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'ESQUECI_PONTO', startDate: day, endDate: day, reason, details: details || null, classification: forgotType }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar o aviso.');
    else {
      setAbsenceMsg('Aviso de ponto esquecido registrado com sucesso.');
      notifyPopup('Esqueci de marcar', 'Aviso enviado à administração.', 'aviso-esqueci');
      setWhatsappText(`🌿 *Espaço Progredir*\n*Esqueci de marcar o ponto*\n────────────────\n👤 ${data?.employee?.name || ''}\n🔢 Mat. ${data?.employee?.employeeNumber || ''}\n📅 ${shortDate.format(new Date(day + 'T12:00:00'))}\n⏱️ ${TYPE_LABEL[forgotType] || forgotType} · ${approxTime || '—'}\n💬 ${reason}`);
      (e.target as HTMLFormElement).reset(); setForgotType('ENTRADA'); setForgotReason('Esqueci de bater no totem');
      await loadRequests();
    }
    setLoading(false);
  }

  async function submitTroca(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError(''); setWhatsappText(null);
    const form = new FormData(e.currentTarget);
    const fromDay = String(form.get('fromDate') || '');
    const toDay = String(form.get('toDate') || '');
    const reason = String(form.get('reason') || '').trim();
    const note = String(form.get('note') || '') || null;
    const response = await fetch('/api/employee/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'TROCA_DIA', startDate: fromDay, endDate: toDay, reason, details: note, classification: 'TROCA_DIA' }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar a troca de dia.');
    else {
      setAbsenceMsg('Pedido de troca de dia registrado com sucesso.');
      notifyPopup('Troca de dia', 'Pedido enviado. Aguarde a análise.', 'aviso-troca');
      setWhatsappText(`🌿 *Espaço Progredir*\n*Troca de dia*\n────────────────\n👤 ${data?.employee?.name || ''}\n🔢 Mat. ${data?.employee?.employeeNumber || ''}\n📅 De ${shortDate.format(new Date(fromDay + 'T12:00:00'))} → ${shortDate.format(new Date(toDay + 'T12:00:00'))}\n💬 ${reason}`);
      (e.target as HTMLFormElement).reset(); await loadRequests();
    }
    setLoading(false);
  }

  async function submitAtraso(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setAbsenceMsg(''); setError(''); setWhatsappText(null);
    const form = new FormData(e.currentTarget);
    const day = String(form.get('lateDate') || todayKey);
    const eta = String(form.get('eta') || '');
    const reason = String(form.get('reason') || '').trim();
    const note = String(form.get('note') || '') || null;
    const details = [eta ? `Previsão de chegada: ${eta}` : null, note].filter(Boolean).join(' · ');
    const response = await fetch('/api/employee/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'AVISO_ATRASO', startDate: day, endDate: day, reason, details: details || null, classification: 'ATRASO', returnExpected: Boolean(eta) }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || 'Não foi possível enviar o aviso de atraso.');
    else {
      setAbsenceMsg('Aviso de atraso registrado com sucesso.');
      notifyPopup('Aviso de atraso', 'A administração foi notificada.', 'aviso-atraso');
      setWhatsappText(`🌿 *Espaço Progredir*\n*Aviso de atraso*\n────────────────\n👤 ${data?.employee?.name || ''}\n🔢 Mat. ${data?.employee?.employeeNumber || ''}\n📅 ${shortDate.format(new Date(day + 'T12:00:00'))}\n⏱️ Chegada prevista: ${eta || '—'}\n💬 ${reason}`);
      (e.target as HTMLFormElement).reset(); await loadRequests();
    }
    setLoading(false);
  }

  function buildReceiptText() {
    const emp = data?.employee;
    if (!emp) return '';
    return ['🌿 ESPAÇO PROGREDIR', 'Ponto Progredir · Comprovante de ponto', '────────────────────', `👤 ${emp.name}`, `🔢 Matrícula: ${emp.employeeNumber || '—'}`, `📅 ${shortDate.format(new Date())}`, `⏱️ Jornada: ${emp.scheduleStart || '--:--'} – ${emp.scheduleEnd || '--:--'}`, '────────────────────', 'Marcações de hoje:', ...(todayPunches.length ? todayPunches.map((p) => `✓ ${timeFmt.format(new Date(p.timestamp))}  ·  ${TYPE_LABEL[p.type] || p.type}`) : ['• Nenhuma marcação registrada ainda']), '────────────────────', 'Acreditando na Vida', 'Documento gerado pelo App do Colaborador'].join('\n');
  }
  function openComprovante() { setShowReceipt(true); }
  function shareComprovante() {
    const text = buildReceiptText();
    if (!text) return;
    if (navigator.share) void navigator.share({ title: 'Comprovante — Espaço Progredir', text }).catch(() => { void navigator.clipboard?.writeText(text); setToast('Comprovante copiado'); window.setTimeout(() => setToast(null), 2500); });
    else { void navigator.clipboard?.writeText(text); setToast('Comprovante copiado'); window.setTimeout(() => setToast(null), 3000); }
  }
  function toggleReminders() {
    if (!remindersOn) { if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); setRemindersOn(true); setToast('Lembretes ativados'); }
    else { setRemindersOn(false); setToast('Lembretes desativados'); }
    window.setTimeout(() => setToast(null), 2500);
  }

  const brandLogo = (<div className="emp-logo-wrap" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>);

  if (sessionStatus !== 'authenticated') {
    return (
      <main className="emp-app emp-login">
        <div className="emp-login-card">
          <div className="emp-brand">{brandLogo}<h1>Ponto <span>Progredir</span></h1><p>Consulte seus pontos e horários de trabalho</p></div>
          <form onSubmit={login} className="emp-form">
            <label>Matrícula<input inputMode="numeric" maxLength={8} required value={matricula} onChange={(e) => setMatricula(e.target.value.replace(/\D/g, ''))} placeholder="Ex.: 1401" autoComplete="username" /></label>
            <button type="submit" className="emp-btn primary" disabled={loading || matricula.length < 3}>{loading ? 'Entrando…' : 'Entrar'}</button>
            {error ? <p className="emp-error" role="alert">{error}</p> : null}
          </form>
          <p className="emp-footer-note">Acesso exclusivo do colaborador · Espaço Progredir</p>
        </div>
      </main>
    );
  }

  const emp = data?.employee;
  const showInstallHint = isStandalone === false && !dismissInstall;
  const certBlock = absenceMsg ? (
    <div className="emp-cert">
      <div className="emp-cert-head">
        <div className="emp-logo-wrap sm" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
        <div><span className="emp-receipt-brand">Espaço Progredir</span><strong>Solicitação registrada</strong></div>
      </div>
      <div className="emp-receipt-goldline" />
      <p className="emp-cert-msg">{absenceMsg}</p>
      <p className="emp-receipt-footer">Aguardando análise da administração</p>
      {whatsappText ? <a className="emp-btn primary emp-wa-btn" href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a> : null}
    </div>
  ) : null;

  return (
    <main className="emp-app">
      {toast ? <div className="emp-toast emp-toast-popup" role="status"><strong>🔔 Notificação</strong><span>{toast}</span></div> : null}
      {showInstallHint ? (
        <div className="emp-install-banner">
          <div><strong>Dica:</strong> instale o app na tela inicial para acesso mais rápido.</div>
          <div className="emp-install-banner-actions">
            {installPrompt ? <button type="button" className="emp-btn primary" onClick={() => void handleInstall()}>Instalar</button> : null}
            <button type="button" className="emp-link" onClick={() => setDismissInstall(true)}>Agora não</button>
          </div>
        </div>
      ) : null}

      <header className="emp-top">
        <div className="emp-top-left">
          <div className="emp-logo-wrap sm" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
          <div>
            <span className="emp-greet">{emp ? `Olá, ${emp.name.split(' ')[0]}` : 'Carregando…'}</span>
            <small>{dateFmt.format(new Date())}</small>
          </div>
        </div>
      </header>

      <div className="emp-content">
        {tab === 'home' && (
          <section className="emp-section">
            <div className="emp-card emp-hero">
              <span className="emp-label">Hoje</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'} às {emp?.scheduleEnd || '--:--'}</strong>
              <p className="emp-muted">Jornada prevista · {emp?.workDays || 'dias não informados'}</p>
            </div>

            {!workDayInfo.worksToday ? (
              <div className="emp-offday">
                <span className="emp-radar-eyebrow">ESCALA</span>
                <strong>{workDayInfo.message}</strong>
                <p>Se precisar avisar a ADM, use o SOS abaixo.</p>
              </div>
            ) : null}
            <div className={`emp-radar tone-${journeyRadar.tone}`}>
              <div className="emp-radar-top">
                <span className="emp-radar-eyebrow">RADAR DA JORNADA</span>
                <strong>{journeyRadar.title}</strong>
                <p>{journeyRadar.detail}</p>
              </div>
              <div className="emp-radar-meta">
                {journeyRadar.nextExpected ? (
                  <div><span>Próxima esperada</span><b>{journeyRadar.nextExpected}</b></div>
                ) : (
                  <div><span>Status</span><b>{journeyRadar.typesCount ? `${journeyRadar.typesCount} batida(s)` : 'Sem batidas'}</b></div>
                )}
                {journeyRadar.delayMin !== null && journeyRadar.delayMin > 0 ? (
                  <div><span>Desvio</span><b>+{journeyRadar.delayMin} min</b></div>
                ) : (
                  <div><span>Jornada</span><b>{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</b></div>
                )}
              </div>
            </div>

            <div className="emp-sos">
              <div className="emp-sos-head">
                <span className="emp-radar-eyebrow">MODO HONESTIDADE · SOS</span>
                <strong>Um toque para a ADM</strong>
                <p>Use quando o dia não ficou redondo ou houve imprevisto.</p>
              </div>
              {sosDone ? (
                <div className="emp-alert-miss ok"><strong>{sosDone}</strong><p>A administração já pode ver em Solicitações.</p></div>
              ) : (
                <div className="emp-sos-grid">
                  <button type="button" className="emp-btn primary" disabled={sosLoading} onClick={() => void sendSos('HONESTY')}>Hoje não ficou redondo</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('ATRASO')}>Vou / estou atrasado</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('NAO_VENHO')}>Não venho hoje</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('EXTERNO')}>Estou em atividade externa</button>
                </div>
              )}
            </div>

            {missingPunchHint && !quickForgotDone ? (
              <div className="emp-alert-miss">
                <div className="emp-alert-miss-head">
                  <span className="emp-alert-miss-icon" aria-hidden>⚠️</span>
                  <div>
                    <strong>Possível ponto não marcado</strong>
                    <p>{missingPunchHint.message}</p>
                  </div>
                </div>
                <button type="button" className="emp-btn primary" disabled={quickForgotLoading} onClick={() => void quickForgot(missingPunchHint.type)}>
                  {quickForgotLoading ? 'Enviando…' : `Avisar ADM — esqueci a ${missingPunchHint.label.toLowerCase()}`}
                </button>
                <button type="button" className="emp-link" onClick={() => { setTab('absences'); setRequestKind('ESQUECI_PONTO'); }}>Detalhar em Avisos</button>
              </div>
            ) : null}
            {quickForgotDone ? (
              <div className="emp-alert-miss ok">
                <strong>Aviso enviado à administração</strong>
                <p>A ADM já pode ver no painel de Solicitações.</p>
              </div>
            ) : null}

            {lastPhoto ? (
              <div className="emp-card"><span className="emp-label">Última foto registrada hoje</span><img src={lastPhoto} alt="Foto da marcação" className="emp-punch-photo" /></div>
            ) : null}
            <div className="emp-card">
              <div className="emp-card-head"><h2>Marcações de hoje</h2><button type="button" className="emp-link" onClick={() => void loadHistory()}>Atualizar</button></div>
              {!todayPunches.length ? <p className="emp-muted">Nenhuma marcação registrada hoje ainda.</p> : (
                <ul className="emp-timeline emp-timeline-photo">
                  {todayPunches.map((p) => (
                    <li key={p.id} className="emp-timeline-row emp-timeline-photo-row">
                      <div className="emp-tl-photo">
                        {p.photoData ? <img src={p.photoData} alt={`Foto ${TYPE_LABEL[p.type] || p.type}`} /> : <span className="emp-thumb placeholder">Sem foto</span>}
                      </div>
                      <div className="emp-tl-body">
                        <strong>{TYPE_LABEL[p.type] || p.type}</strong>
                        <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                        <span className="emp-pill ok">Registrada</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="emp-grid-2">
              <button type="button" className="emp-btn primary" onClick={() => openComprovante()}>📄 Comprovante</button>
              <button type="button" className="emp-btn primary" onClick={() => toggleReminders()}>{remindersOn ? '🔔 Lembretes ON' : '🔕 Lembretes'}</button>
            </div>
          </section>
        )}

        {tab === 'journey' && (
          <section className="emp-section">
            <div className="emp-card">
              <span className="emp-label">Sua jornada cadastrada</span>
              <strong className="emp-big">{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</strong>
              <p className="emp-muted">{emp?.workDays || 'Dias não informados'}</p>
            </div>
          </section>
        )}

        {tab === 'month' && (
          <section className="emp-section">
            <div className="emp-card">
              <div className="emp-card-head">
                <button type="button" className="emp-link" onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
                <strong>{new Date(monthCursor.year, monthCursor.month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
                <button type="button" className="emp-link" onClick={() => setMonthCursor((c) => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
              </div>
              <div className="emp-cal-grid">
                {Array.from({ length: new Date(monthCursor.year, monthCursor.month + 1, 0).getDate() }, (_, i) => {
                  const day = i + 1;
                  const key = shortDate.format(new Date(monthCursor.year, monthCursor.month, day));
                  const has = punchesByDay.has(key);
                  return (
                    <button key={day} type="button" className={`emp-cal-day ${has ? 'has' : ''} ${selectedDay === key ? 'selected' : ''}`} onClick={() => setSelectedDay(key)}>
                      {day}{has ? <i className="dot green" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedDay && (
              <div className="emp-card">
                <h2>{selectedDay}</h2>
                <ul className="emp-timeline">
                  {(punchesByDay.get(selectedDay) || []).map((p) => (
                    <li key={p.id}><span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span><span>{TYPE_LABEL[p.type] || p.type}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === 'absences' && (
          <section className="emp-section">
            <div className="emp-card">
              <div className="emp-segment emp-segment-wrap">
                <button type="button" className={requestKind === 'AUSENCIA' ? 'active' : ''} onClick={() => { setRequestKind('AUSENCIA'); setAbsenceMsg(''); setError(''); setWhatsappText(null); }}>Ausência</button>
                <button type="button" className={requestKind === 'ESQUECI_PONTO' ? 'active' : ''} onClick={() => { setRequestKind('ESQUECI_PONTO'); setAbsenceMsg(''); setError(''); setWhatsappText(null); }}>Esqueci ponto</button>
                <button type="button" className={requestKind === 'AVISO_ATRASO' ? 'active' : ''} onClick={() => { setRequestKind('AVISO_ATRASO'); setAbsenceMsg(''); setError(''); setWhatsappText(null); }}>Atraso</button>
                <button type="button" className={requestKind === 'TROCA_DIA' ? 'active' : ''} onClick={() => { setRequestKind('TROCA_DIA'); setAbsenceMsg(''); setError(''); setWhatsappText(null); }}>Troca de dia</button>
              </div>
            </div>

            {requestKind === 'ESQUECI_PONTO' ? (
            <div className="emp-card">
              <h2>Esqueci de marcar o ponto</h2>
              <form onSubmit={submitForgot} className="emp-form">
                <label>Data<input name="forgotDate" type="date" required /></label>
                <label>Horário aproximado<input name="forgotTime" type="time" required /></label>
                <label>Qual batida?<select value={forgotType} onChange={(e) => setForgotType(e.target.value)} required>{FORGOT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label>Motivo<select value={forgotReason} onChange={(e) => setForgotReason(e.target.value)} required>{FORGOT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                {forgotReason === 'Outros' ? <label>Descreva<input name="reasonOther" required maxLength={200} /></label> : null}
                <label>Observação<textarea name="note" rows={2} maxLength={500} /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Enviar aviso'}</button>
                {certBlock}
                {error ? <p className="emp-error">{error}</p> : null}
              </form>
            </div>
            ) : requestKind === 'AVISO_ATRASO' ? (
            <div className="emp-card">
              <h2>Aviso de atraso</h2>
              <form onSubmit={submitAtraso} className="emp-form">
                <label>Data<input name="lateDate" type="date" required defaultValue={todayKey} /></label>
                <label>Previsão de chegada<input name="eta" type="time" required /></label>
                <label>Motivo<input name="reason" required maxLength={200} placeholder="Ex.: Trânsito" /></label>
                <label>Observação<textarea name="note" rows={2} maxLength={500} /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Enviar aviso de atraso'}</button>
                {certBlock}
                {error ? <p className="emp-error">{error}</p> : null}
              </form>
            </div>
            ) : requestKind === 'TROCA_DIA' ? (
            <div className="emp-card">
              <h2>Troca de dia</h2>
              <form onSubmit={submitTroca} className="emp-form">
                <label>Dia de origem<input name="fromDate" type="date" required /></label>
                <label>Dia proposto<input name="toDate" type="date" required /></label>
                <label>Motivo<input name="reason" required maxLength={200} /></label>
                <label>Observação<textarea name="note" rows={2} maxLength={500} /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Solicitar troca de dia'}</button>
                {certBlock}
                {error ? <p className="emp-error">{error}</p> : null}
              </form>
            </div>
            ) : (
            <div className="emp-card">
              <h2>Aviso de ausência</h2>
              <div className="emp-segment">
                <button type="button" className={absenceMode === 'HORAS' ? 'active' : ''} onClick={() => setAbsenceMode('HORAS')}>Por horas</button>
                <button type="button" className={absenceMode === 'DIAS' ? 'active' : ''} onClick={() => setAbsenceMode('DIAS')}>Por dias</button>
              </div>
              <form onSubmit={submitAbsence} className="emp-form">
                <label>Tipo<select value={coverage} onChange={(e) => setCoverage(e.target.value)} required>{COVERAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label>Data {absenceMode === 'DIAS' ? 'inicial' : ''}<input name="startDate" type="date" required /></label>
                {absenceMode === 'DIAS' ? <label>Data final<input name="endDate" type="date" required /></label> : (
                  <div className="emp-grid-2">
                    <label>Hora inicial<input name="startTime" type="time" /></label>
                    <label>Hora final<input name="endTime" type="time" /></label>
                  </div>
                )}
                <label>Motivo<select value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)} required>{ABSENCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                {reasonChoice === 'Outros' ? <label>Descreva<input name="reasonOther" required maxLength={200} /></label> : null}
                <label>Previsão de volta<input name="returnTime" type="time" /></label>
                <label>Observação<textarea name="note" rows={2} maxLength={500} /></label>
                <label>Anexo<input name="document" type="file" accept=".pdf,image/jpeg,image/png" /></label>
                <button type="submit" className="emp-btn primary" disabled={loading}>{loading ? 'Enviando…' : 'Enviar'}</button>
                {certBlock}
                {error ? <p className="emp-error">{error}</p> : null}
              </form>
            </div>
            )}

            <div className="emp-card">
              <h2>Minhas solicitações</h2>
              {!requests.length ? <p className="emp-muted">Nenhuma solicitação ainda.</p> : (
                <ul className="emp-req-list">
                  {requests.slice(0, 20).map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>{r.reason}</strong>
                        <small>{shortDate.format(new Date(r.startDate))}{r.endDate !== r.startDate ? ` → ${shortDate.format(new Date(r.endDate))}` : ''}</small>
                      </div>
                      <span className={`emp-pill ${r.status === 'APROVADO' ? 'ok' : r.status === 'REJEITADO' ? 'bad' : 'warn'}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'profile' && (
          <section className="emp-section">
            <div className="emp-card profile">
              <div className="emp-logo-wrap" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
              <h2>{emp?.name}</h2>
              <p>Matrícula {emp?.employeeNumber || '—'}</p>
              <p>{emp?.jobTitle || emp?.profile?.jobTitleFromPdf || 'Cargo não informado'}</p>
            </div>
            <div className="emp-card">
              <h2>Dados cadastrais</h2>
              <div className="emp-row"><span>CPF</span><strong>{emp?.cpf || '—'}</strong></div>
              <div className="emp-row"><span>RG</span><strong>{emp?.profile?.rg || '—'}</strong></div>
              <div className="emp-row"><span>PIS</span><strong>{emp?.profile?.pis || '—'}</strong></div>
              <div className="emp-row"><span>Nascimento</span><strong>{emp?.profile?.birthDate || '—'}</strong></div>
              <div className="emp-row"><span>Sexo</span><strong>{emp?.profile?.sex || '—'}</strong></div>
              <div className="emp-row"><span>Estado civil</span><strong>{emp?.profile?.maritalStatus || '—'}</strong></div>
              <div className="emp-row"><span>Admissão</span><strong>{emp?.profile?.admissionDate || '—'}</strong></div>
              <div className="emp-row"><span>Departamento</span><strong>{emp?.profile?.department || '—'}</strong></div>
              <div className="emp-row"><span>Unidade</span><strong>{emp?.unitName || '—'}</strong></div>
              <div className="emp-row"><span>Status</span><strong className="emp-status ok">{emp?.active === false ? 'Inativo' : 'Ativo'}</strong></div>
            </div>
            <div className="emp-card">
              <h2>Contato</h2>
              <div className="emp-row"><span>Telefone</span><strong>{emp?.profile?.phone || '—'}</strong></div>
              <div className="emp-row"><span>E-mail</span><strong>{emp?.profile?.personalEmail || '—'}</strong></div>
            </div>
            <div className="emp-card">
              <h2>Endereço</h2>
              <div className="emp-row"><span>Logradouro</span><strong>{[emp?.profile?.address, emp?.profile?.number ? `nº ${emp.profile.number}` : null, emp?.profile?.complement].filter(Boolean).join(', ') || '—'}</strong></div>
              <div className="emp-row"><span>Bairro</span><strong>{emp?.profile?.neighborhood || '—'}</strong></div>
              <div className="emp-row"><span>Cidade/UF</span><strong>{emp?.profile?.city ? `${emp.profile.city}${emp.profile.uf ? `/${emp.profile.uf}` : ''}` : '—'}</strong></div>
              <div className="emp-row"><span>CEP</span><strong>{emp?.profile?.cep || '—'}</strong></div>
            </div>
            <div className="emp-card">
              <h2>Jornada</h2>
              <div className="emp-row"><span>Horário padrão</span><strong>{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</strong></div>
              <div className="emp-row"><span>Dias</span><strong>{emp?.workDays || '—'}</strong></div>
            </div>
            <div className="emp-card">
              <h2>Documentos trabalhistas</h2>
              <div className="emp-row"><span>CTPS</span><strong>{emp?.profile?.ctps || '—'}</strong></div>
              <div className="emp-row"><span>Série CTPS</span><strong>{emp?.profile?.ctpsSeries || '—'}</strong></div>
              <div className="emp-row"><span>Mãe</span><strong>{emp?.profile?.motherName || '—'}</strong></div>
              <div className="emp-row"><span>Pai</span><strong>{emp?.profile?.fatherName || '—'}</strong></div>
            </div>
            <p className="emp-muted" style={{ textAlign: 'center' }}>Os dados vêm do cadastro administrativo. Em caso de divergência, fale com a ADM.</p>
            <button type="button" className="emp-btn danger" onClick={() => void signOut({ callbackUrl: '/app' })}>Sair</button>
          </section>
        )}
      </div>

      {showReceipt ? (
        <div className="emp-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowReceipt(false)}>
          <div className="emp-receipt" onClick={(e) => e.stopPropagation()}>
            <div className="emp-receipt-top">
              <div className="emp-logo-wrap sm" aria-hidden><img src="/ponto-progredir-icon-circular.png" alt="" className="emp-logo-img" /></div>
              <div><span className="emp-receipt-brand">Espaço Progredir</span><strong>Comprovante de ponto</strong></div>
            </div>
            <div className="emp-receipt-goldline" />
            <div className="emp-receipt-body">
              <div className="emp-receipt-row"><span>Colaborador</span><strong>{emp?.name}</strong></div>
              <div className="emp-receipt-row"><span>Matrícula</span><strong>{emp?.employeeNumber || '—'}</strong></div>
              <div className="emp-receipt-row"><span>Data</span><strong>{shortDate.format(new Date())}</strong></div>
              <div className="emp-receipt-row"><span>Jornada</span><strong>{emp?.scheduleStart || '--:--'} – {emp?.scheduleEnd || '--:--'}</strong></div>
            </div>
            <div className="emp-receipt-section">
              <span className="emp-receipt-section-title">Marcações de hoje</span>
              {todayPunches.length ? (
                <ul className="emp-receipt-list">{todayPunches.map((p) => (<li key={p.id}><span>{timeFmt.format(new Date(p.timestamp))}</span><strong>{TYPE_LABEL[p.type] || p.type}</strong></li>))}</ul>
              ) : <p className="emp-muted">Nenhuma marcação registrada ainda.</p>}
            </div>
            <p className="emp-receipt-footer">Acreditando na Vida · App do Colaborador</p>
            <div className="emp-receipt-actions">
              <button type="button" className="emp-btn primary" onClick={() => shareComprovante()}>Compartilhar</button>
              <button type="button" className="emp-link" onClick={() => setShowReceipt(false)}>Fechar</button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="emp-bottom-nav" aria-label="Menu principal">
        {([['home', 'Início', '🏠'], ['journey', 'Jornada', '⏱️'], ['month', 'Meu mês', '📅'], ['absences', 'Avisos', '📝'], ['profile', 'Perfil', '👤']] as const).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span aria-hidden>{icon}</span>{label}
          </button>
        ))}
      </nav>
    </main>
  );
}
