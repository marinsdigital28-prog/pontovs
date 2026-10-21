"use client";

import React, { memo, useEffect, useState } from 'react';
import InstallAppButton from '../../components/InstallAppButton';
import './totem.css';
import InstallBanner from './InstallBanner';

const ArrowIcon = () => <svg viewBox="0 0 24 24" aria-hidden className="t-ico"><path d="M4 12h15M13 6l6 6-6 6" /></svg>;
const BackspaceIcon = () => <svg viewBox="0 0 32 24" aria-hidden className="t-ico t-ico-bs"><path d="M10 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H10L2 12z" /><path d="M15 8l8 8M23 8l-8 8" /></svg>;
const CameraIcon = () => <svg viewBox="0 0 24 24" aria-hidden className="t-ico"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.8" /></svg>;
const Rays = ({ className }: { className: string }) => <svg viewBox="0 0 120 70" aria-hidden className={className}><path d="M20 66a40 40 0 0 1 80 0" /><path d="M60 18V2M38 24 30 10M82 24l8-14M24 38 10 30M96 38l14-8" /></svg>;

const TZ = 'America/Sao_Paulo';
/** Tempo que a tela de sucesso fica visível antes de voltar sozinha para a próxima matrícula. */
const SUCCESS_SCREEN_MS = 4000;
const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída para intervalo', RETORNO: 'Retorno do intervalo', SAIDA: 'Saída', PENDENTE: 'Salva no aparelho' };
const TYPE_ICON: Record<string, string> = { ENTRADA: '→', INTERVALO: '☕', RETORNO: '↩', SAIDA: '←', PENDENTE: '⟳' };
function greeting(date: Date | null) { const h = date ? Number(date.toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ })) : 8; return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }

/* Som de confirmação gerado na hora (Web Audio), sem arquivo externo. */
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
  } catch { /* sem áudio */ }
}
function tone(freq: number, start: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + start;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
/* Clique de tecla: tique curto e baixo; corta o anterior para não acumular. */
let lastClick: OscillatorNode | null = null;
function keyClick(soft: boolean) {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== 'running') return;
  try {
    if (lastClick) { try { lastClick.stop(); } catch { /* já parou */ } lastClick = null; }
    const t0 = ctx.currentTime;
    const dur = soft ? 0.032 : 0.026;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = soft ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(soft ? 520 : 1250, t0);
    osc.frequency.exponentialRampToValueAtTime(soft ? 380 : 900, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(soft ? 0.05 : 0.07, t0 + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); if (lastClick === osc) lastClick = null; };
    osc.start(t0);
    osc.stop(t0 + dur + 0.005);
    lastClick = osc;
  } catch { /* sem áudio */ }
}
function playSuccess() {
  try { (navigator as any).vibrate?.([80, 60, 120]); } catch { /* sem vibração */ }
  try { unlockAudio(); tone(659.25, 0, 0.22, 0.18); tone(987.77, 0.14, 0.28, 0.16); } catch { /* sem áudio */ }
}
function playError() {
  try { unlockAudio(); tone(220, 0, 0.16, 0.08, 'triangle'); } catch { /* sem áudio */ }
}

/** Efeito visual de toque nas teclas (só transform/opacity). Não altera o fluxo. */
function keyFx(btn: HTMLElement | null, x?: number, y?: number) {
  if (!btn) return;
  unlockAudio();
  keyClick(btn.classList.contains('t-key-fn'));
  try { (navigator as any).vibrate?.(10); } catch { /* sem vibração */ }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // lê a geometria agora (antes de qualquer escrita) e aplica o efeito no próximo quadro
  const r = btn.getBoundingClientRect();
  requestAnimationFrame(() => {
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 't-ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${(x ?? r.left + r.width / 2) - r.left - size / 2}px;top:${(y ?? r.top + r.height / 2) - r.top - size / 2}px`;
    btn.appendChild(dot);
    btn.classList.add('is-fx');
    window.setTimeout(() => { dot.remove(); btn.classList.remove('is-fx'); }, 200);
  });
}
function keyFxFor(key: string) {
  const label = key === 'C' ? 'Limpar matrícula' : key === '⌫' ? 'Apagar último dígito' : `Tecla ${key}`;
  keyFx(document.querySelector(`button[aria-label="${label}"]`) as HTMLElement | null);
}

const TotemClock = memo(function TotemClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dayString = now ? now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }) : '';
  const timeString = now ? now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '--:--:--';
  const [hhmm, ss] = [timeString.slice(0, 5), timeString.slice(6, 8)];
  return (
    <div className="t-clock-text">
      <div className="t-greet">{greeting(now)}!</div>
      <div className="t-time" aria-live="off"><span className="t-hhmm">{hhmm}</span><span className="t-ss">{ss}</span></div>
      <div className="t-date">{dayString}</div>
    </div>
  );
});

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [step, setStep] = useState<'lookup' | 'register'>('lookup');
  const [matricula, setMatricula] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [nextType, setNextType] = useState<'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO' | null>('ENTRADA');
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ type: string; timestamp: string; location?: { lat: number; lng: number } | null; id?: string; duplicate?: boolean } | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const autoLookupRef = React.useRef('');
  const pendingClientIdRef = React.useRef<string | null>(null);
  const submittingRef = React.useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [journeyClosed, setJourneyClosed] = useState(false);
  const [shakeTick, setShakeTick] = useState(0);

  const keypadNumbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  function appendDigit(nextValue: string) {
    if (nextValue === 'C') {
      setShakeTick((n) => n + 1);
      setMatricula('');
      return;
    }
    if (nextValue === '⌫') {
      setMatricula((current) => current.slice(0, -1));
      return;
    }
    setMatricula((current) => (current + nextValue).replace(/\D/g, '').slice(0, 8));
  }

  useEffect(() => {
    if (step !== 'register' || !employee || cameraOpen || photo || confirmation || loading) return;
    void handlePhotoSelection();
  }, [step, employee, cameraOpen, photo, confirmation, loading]);

  useEffect(() => {
    const value = matricula.replace(/\D/g, '').trim();
    if (step !== 'lookup' || value.length < 4) {
      autoLookupRef.current = '';
      return;
    }
    if (autoLookupRef.current === value || loading) return;
    const timer = window.setTimeout(() => {
      autoLookupRef.current = value;
      void handleLookup();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [matricula, step, loading]);

  async function handleLookup() {
    setLoading(true);
    setStatusMsg(null);
    setJourneyClosed(false);
    const normalizedEmployeeNumber = matricula.replace(/\D/g, '').padStart(4, '0');
    try {
      const r = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeNumber: matricula.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 503 && data.code === 'DATABASE_QUOTA_EXCEEDED') {
          closeCamera();
          setEmployee({ employeeNumber: normalizedEmployeeNumber, name: 'Colaborador', offline: true });
          setNextType('ENTRADA');
          setStep('register');
          setStatusMsg('Banco indisponível. A câmera será aberta para salvar a marcação no aparelho e sincronizar depois.');
          return;
        }
        throw new Error(data.error || 'Matrícula não encontrada');
      }
      const recognizedNextType = data.nextType as 'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO' | null;
      if (!recognizedNextType) {
        closeCamera();
        setEmployee(null);
        setNextType('ENTRADA');
        setStep('lookup');
        setMatricula('');
        setPhoto(null);
        setConfirmation(null);
        autoLookupRef.current = '';
        setJourneyClosed(true);
        setStatusMsg('Jornada encerrada — todas as marcações de hoje já foram registradas.');
        window.setTimeout(() => setJourneyClosed(false), 4500);
        return;
      }
      setEmployee(data);
      setNextType(recognizedNextType);
      setStep('register');
      setStatusMsg(data.offlineFallback
        ? 'Funcionário reconhecido. Preparando a câmera para salvar a marcação neste aparelho.'
        : 'Funcionário reconhecido. Preparando a câmera...');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Matrícula inválida');
    } finally {
      setLoading(false);
    }
  }

  function queueOfflinePunch(payload: { employeeNumber: string; clientTimestamp: string; clientId: string; photo: string | null; origin: 'OFFLINE'; connectivity: 'OFFLINE' | 'RETRYING'; location: { lat: number; lng: number; accuracy?: number; capturedAt: string } | null; device: { id?: string; os?: string; appVersion?: string } | null }, reason: string) {
    const offline = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
    offline.push(payload);
    localStorage.setItem('offlinePunches', JSON.stringify(offline));
    pendingClientIdRef.current = null;
    setConfirmation({ type: 'PENDENTE', timestamp: payload.clientTimestamp });
    setStatusMsg(reason);
    setLoading(false);
    window.setTimeout(() => resetForNextCollaborator(), SUCCESS_SCREEN_MS);
  }

  async function readCurrentLocation() {
    if (!navigator.geolocation) return null;
    return await new Promise<{ lat: number; lng: number; accuracy?: number; capturedAt: string } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined, capturedAt: new Date().toISOString() }), () => resolve(null), { enableHighAccuracy: false, timeout: 2500, maximumAge: 120000 });
    });
  }

  function deviceDetails() {
    try {
      const storageKey = 'pontoDeviceId';
      const id = localStorage.getItem(storageKey) || (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(storageKey, id);
      return { id, os: navigator.userAgent.slice(0, 80), appVersion: 'web' };
    } catch { return { os: navigator.userAgent.slice(0, 80), appVersion: 'web' }; }
  }

  async function handlePunch(photoOverride?: string | null) {
    if (!employee) return;
    if (submittingRef.current || loading) return;
    submittingRef.current = true;
    const offlineMode = Boolean(employee.offline || employee.offlineFallback || !navigator.onLine);
    const location = await readCurrentLocation();
    const payload = {
      employeeNumber: employee.employeeNumber,
      clientTimestamp: new Date().toISOString(),
      clientId: pendingClientIdRef.current ?? (pendingClientIdRef.current = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      origin: offlineMode ? 'OFFLINE' as const : 'WEB' as const,
      connectivity: offlineMode ? 'OFFLINE' as const : 'ONLINE' as const,
      location,
      device: deviceDetails(),
      photo: photoOverride ?? photo ?? null,
    };
    if (offlineMode) {
      queueOfflinePunch({ ...payload, origin: 'OFFLINE', connectivity: 'OFFLINE' }, employee.offline || employee.offlineFallback
        ? 'Marcação salva no aparelho — será sincronizada assim que o banco voltar.'
        : 'Sem conexão — marcação protegida no aparelho e será sincronizada automaticamente');
      submittingRef.current = false;
      return;
    }
    setLoading(true);
    setStatusMsg('Registrando ponto com foto...');
    try {
      const r = await fetch('/api/punch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) {
        const apiError = new Error(json.error || 'Erro ao registrar ponto');
        (apiError as any).code = json.code;
        throw apiError;
      }
      setNextType(nextAfter(json.type));
      pendingClientIdRef.current = null;
      setConfirmation({
        type: json.type,
        timestamp: json.timestamp,
        id: typeof json.id === 'string' ? json.id : undefined,
        duplicate: Boolean(json.duplicate),
      });
      if (json.duplicate) {
        setStatusMsg('Marcação já registrada há pouco. Evitando duplicidade.');
        window.setTimeout(() => resetForNextCollaborator(), SUCCESS_SCREEN_MS);
        return;
      }
      const receiptStatus = json.receiptEmail?.status;
      setStatusMsg(receiptStatus === 'sent'
        ? 'Ponto registrado. Comprovante enviado para seu email.'
        : receiptStatus === 'not_configured'
          ? 'Ponto registrado. Comprovante pendente de configuração do email.'
          : receiptStatus === 'failed'
            ? 'Ponto registrado. Não foi possível enviar o comprovante por email.'
            : 'Ponto registrado e sincronizado. Preparando a próxima matrícula...');
      window.setTimeout(() => resetForNextCollaborator(), SUCCESS_SCREEN_MS);
    } catch (err: any) {
      const errorMessage = err?.message || 'Não foi possível registrar a marcação. Tente novamente.';
      if (err?.code === 'DATABASE_QUOTA_EXCEEDED') {
        const pending = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
        pending.push({ ...payload, origin: 'OFFLINE', connectivity: 'RETRYING' });
        localStorage.setItem('offlinePunches', JSON.stringify(pending));
        setStatusMsg('Marcação salva neste aparelho e aguardando sincronização quando o banco for liberado.');
        return;
      }
      if (/jornada.*encerrad|todas.*marcaç|todas.*batida/i.test(errorMessage)) {
        closeCamera();
        setPhoto(null);
        setConfirmation(null);
        setEmployee(null);
        setNextType('ENTRADA');
        setStep('lookup');
        setMatricula('');
        pendingClientIdRef.current = null;
        autoLookupRef.current = '';
        setJourneyClosed(true);
        setStatusMsg('Jornada encerrada — todas as marcações de hoje já foram registradas.');
        window.setTimeout(() => setJourneyClosed(false), 4500);
        return;
      }
      const isNetworkFailure = err instanceof TypeError || !navigator.onLine;
      if (isNetworkFailure) {
        queueOfflinePunch({ ...payload, origin: 'OFFLINE', connectivity: 'RETRYING' }, 'Sem conexão — salvo localmente e será reenviado quando online');
      } else {
        setStatusMsg(errorMessage);
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
      if (!confirmation) {
        setTimeout(() => setStatusMsg(null), 5000);
      }
    }
  }

  useEffect(() => {
    let syncing = false;
    const sync = async () => {
      if (syncing || !navigator.onLine) return;
      const pending = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
      if (!pending || pending.length === 0) return;
      syncing = true;
      const remaining: any[] = [];
      try {
        for (const p of pending) {
          const response = await fetch('/api/punch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...p, origin: 'OFFLINE', connectivity: 'RETRYING' }) });
          if (!response.ok) remaining.push(p);
        }
        if (remaining.length > 0) localStorage.setItem('offlinePunches', JSON.stringify(remaining));
        else localStorage.removeItem('offlinePunches');
        if (remaining.length < pending.length) {
          setStatusMsg(remaining.length > 0 ? 'Algumas marcações continuam pendentes.' : 'Marcações pendentes sincronizadas');
          setTimeout(() => setStatusMsg(null), 3000);
        }
      } catch {
        localStorage.setItem('offlinePunches', JSON.stringify(pending));
      } finally {
        syncing = false;
      }
    };
    void sync();
    const retryTimer = window.setInterval(() => { if (navigator.onLine) void sync(); }, 60000);
    window.addEventListener('online', sync);
    return () => {
      window.clearInterval(retryTimer);
      window.removeEventListener('online', sync);
    };
  }, []);


  function resetForNextCollaborator() {
    closeCamera();
    setStep('lookup');
    setMatricula('');
    setEmployee(null);
    setNextType('ENTRADA');
    setPhoto(null);
    setConfirmation(null);
    setStatusMsg(null);
    setJourneyClosed(false);
    autoLookupRef.current = '';
    pendingClientIdRef.current = null;
  }

  function nextAfter(type: string): 'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO' | null {
    const order = ['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA'];
    const index = order.indexOf(type);
    return index >= 0 && index < order.length - 1 ? order[index + 1] as 'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO' : null;
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  async function handlePhotoSelection() {
    setPhoto(null);
    setConfirmation(null);
    setStatusMsg('Abrindo câmera...');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMsg('Este navegador não permite câmera interna. Abra o endereço em HTTPS no celular.');
      return;
    }
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      setCameraOpen(true);
      setStatusMsg('Câmera pronta. Posicione o rosto e toque em Marcar ponto.');
    } catch {
      setStatusMsg('Permita o acesso à câmera frontal para continuar.');
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  async function capturePhoto() {
    unlockAudio();
    if (submittingRef.current || loading) return;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setStatusMsg('A câmera ainda está iniciando. Aguarde um instante.');
      return;
    }
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - size) / 2;
    const sourceY = (video.videoHeight - size) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    canvas.getContext('2d')?.drawImage(video, sourceX, sourceY, size, size, 0, 0, 480, 480);
    const capturedPhoto = canvas.toDataURL('image/jpeg', 0.72);
    setPhoto(capturedPhoto);
    closeCamera();
    setStatusMsg('Registrando...');
    await handlePunch(capturedPhoto);
  }

  // Teclado físico: números, Backspace, Esc (limpar), Enter (Continuar / Marcar ponto / próximo).
  const keyHandlerRef = React.useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (confirmation) { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); resetForNextCollaborator(); } return; }
    if (step === 'lookup') {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keyFxFor(e.key); appendDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); keyFxFor('⌫'); appendDigit('⌫'); }
      else if (e.key === 'Escape' || e.key === 'Delete') { e.preventDefault(); keyFxFor('C'); appendDigit('C'); }
      else if (e.key === 'Enter' && matricula.trim() && !loading) { e.preventDefault(); void handleLookup(); }
      return;
    }
    if (step === 'register') {
      if ((e.key === 'Enter' || e.key === ' ') && cameraOpen && !loading) { e.preventDefault(); void capturePhoto(); }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const typeLabel = (type: string) => TYPE_LABEL[type] || type;
  const confirmedAt = confirmation ? new Date(confirmation.timestamp) : null;
  const digits = matricula.replace(/\D/g, '');
  const slotCount = Math.min(8, Math.max(4, digits.length + (digits.length < 8 ? 1 : 0)));
  const done = Boolean(confirmation);
  const lookupError = step === 'lookup' && !loading && !journeyClosed && Boolean(statusMsg);
  const confirmationKey = confirmation ? `${confirmation.type}|${confirmation.timestamp}` : '';
  useEffect(() => { if (confirmationKey) playSuccess(); }, [confirmationKey]);
  useEffect(() => { if (lookupError) playError(); }, [lookupError, statusMsg]);

  return (
    <main className={`ponto-kiosk-container totem totem-step-${done ? 'done' : step}`}>
      <div className="t-layout">
        <section className="ponto-info-panel t-left" aria-label="Data e hora">
          {done ? <img src="/logo-progredir.svg" alt="Espaço Progredir — Acreditando na Vida" className="t-logo" width={497} height={419} /> : null}
          {!done ? (
            <div className="t-card t-clock-card">
              <Rays className="t-rays t-rays-top" />
              <div className="t-clock-row">
                <img src="/logo-progredir.svg" alt="Espaço Progredir — Acreditando na Vida" className="t-logo t-logo-inline" width={497} height={419} />
                <TotemClock />
              </div>
              {step === 'register' && employee ? (
                <div className="t-who" key={employee.employeeNumber}>
                  <span className="t-chip t-chip-strong">Matrícula {employee.employeeNumber}</span>
                  <strong className="t-who-name">{employee.name}</strong>
                  {nextType ? <span className="t-chip">Próxima marcação: {typeLabel(nextType)}</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="ponto-input-panel t-right">
        {step === 'lookup' && (
          <div className="t-card t-lookup t-fade" aria-label="Digite seu número de matrícula">
            {journeyClosed && statusMsg && (
              <div className="t-notice t-notice-gold" role="status">
                <strong>Jornada encerrada</strong>
                <span>{statusMsg}</span>
              </div>
            )}
            <div className="t-label" id="totem-mat-label">MATRÍCULA</div>
            <div key={`slots-${shakeTick}-${lookupError ? statusMsg : ''}`} className={`t-slots ${loading ? 'is-loading' : ''} ${shakeTick > 0 || lookupError ? 'is-shake' : ''}`} style={{ ['--slots' as any]: slotCount }} aria-labelledby="totem-mat-label" aria-live="polite" aria-label={digits ? `Matrícula ${digits.split('').join(' ')}` : 'Digite seu número de matrícula'}>
              {Array.from({ length: slotCount }, (_, i) => (
                <span key={i} className={`t-slot ${digits[i] ? 'is-filled' : i === digits.length ? 'is-active' : 'is-empty'}`}>{digits[i] ?? ''}</span>
              ))}
            </div>

            <div className="t-keypad" role="group" aria-label="Teclado numérico">
              {keypadNumbers.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`t-key ${key === 'C' || key === '⌫' ? 't-key-fn' : ''}`}
                  onPointerDown={(ev) => { if (ev.button > 0) return; appendDigit(key); keyFx(ev.currentTarget, ev.clientX, ev.clientY); }}
                  onClick={(ev) => { if (ev.detail === 0) { appendDigit(key); keyFx(ev.currentTarget); } }}
                  aria-label={key === 'C' ? 'Limpar matrícula' : key === '⌫' ? 'Apagar último dígito' : `Tecla ${key}`}
                >
                  {key === 'C' ? 'Limpar' : key === '⌫' ? <BackspaceIcon /> : key}
                </button>
              ))}
            </div>

            <button type="button" className="t-btn t-continue" onClick={handleLookup} disabled={loading || !matricula.trim()}>
              <span>{loading ? 'Buscando...' : 'Continuar'}</span>{loading ? <span className="t-spinner" aria-hidden /> : <ArrowIcon />}
            </button>
            {statusMsg && !journeyClosed && <div className="t-status" role="status">{statusMsg}</div>}
          </div>
        )}

        {step === 'register' && employee && !done && (
          <div className="t-card t-register t-fade">
            {cameraOpen ? (
              <>
                <div className="t-camera">
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  <span className="t-face-guide" aria-hidden />
                </div>
                <p className="t-hint">Posicione o rosto e toque em Marcar ponto</p>
                <button type="button" className="t-btn t-mark" onClick={() => void capturePhoto()} disabled={loading}>
                  <CameraIcon /><span>{loading ? 'Registrando...' : 'Marcar ponto'}</span>
                </button>
              </>
            ) : photo ? (
              <>
                <div className="t-camera"><img src={photo} alt="Foto capturada" /></div>
                <button type="button" className="t-btn t-mark" onClick={() => void handlePunch(photo)} disabled={loading}>
                  <span>{loading ? 'Registrando...' : 'Tentar registrar novamente'}</span>
                </button>
              </>
            ) : (
              <>
                <div className="t-camera t-camera-off"><CameraIcon /></div>
                <div className="t-notice">{statusMsg || 'Câmera indisponível. Toque para tentar novamente.'}</div>
                <button type="button" className="t-btn t-mark" onClick={() => void handlePhotoSelection()} disabled={loading}><CameraIcon /><span>Abrir câmera</span></button>
              </>
            )}
            {statusMsg && (cameraOpen || photo) && !statusMsg.startsWith('Câmera pronta') && <div className="t-status" role="status">{statusMsg}</div>}
          </div>
        )}

        {step === 'register' && employee && confirmation && (
          <div className={`t-success t-type-${confirmation.type}`} role="status" aria-live="assertive">
            <div className="t-card t-receipt-card">
              <div className="confirmation-check t-check" aria-hidden>
                <svg viewBox="0 0 120 120"><g className="t-sunrays">{Array.from({ length: 12 }, (_, i) => <line key={i} x1="60" y1="6" x2="60" y2="18" transform={`rotate(${i * 30} 60 60)`} />)}</g><circle cx="60" cy="60" r="34" /><path d="M44 61l11 11 22-24" /></svg>
              </div>
              <div className="t-success-title">{confirmation.type === 'PENDENTE' ? 'Marcação salva!' : confirmation.duplicate ? 'Já registrado!' : 'Ponto registrado!'}</div>
              <div className="t-success-name">{employee.name}</div>
              <dl className="t-receipt">
                <dt>Tipo:</dt><dd>{typeLabel(confirmation.type)}</dd>
                <dt>Horário:</dt><dd>{confirmedAt ? confirmedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '—'}</dd>
                <dt>Data:</dt><dd>{confirmedAt ? confirmedAt.toLocaleDateString('pt-BR', { timeZone: TZ }) : '—'}</dd>
                {confirmation.id ? <><dt>Registro:</dt><dd className="t-mono">…{confirmation.id.slice(-10).toUpperCase()}</dd></> : null}
              </dl>
              {statusMsg ? <div className="t-status t-status-in">{statusMsg}</div> : null}
            </div>
            <button type="button" className="t-btn t-nextbtn" onClick={() => resetForNextCollaborator()}><span>Próximo colaborador</span><ArrowIcon /></button>
            <div className="t-countdown-label"><Countdown ms={SUCCESS_SCREEN_MS} /></div>
            <div className="t-countdown"><span style={{ animationDuration: `${SUCCESS_SCREEN_MS}ms` }} /></div>
          </div>
        )}
        </section>
      </div>
      {step === 'lookup' && !done ? <InstallBanner /> : null}
      <footer className="t-footer"><span>Ponto eletrônico • Portaria 671 MTE</span><div className="t-install"><InstallAppButton compact /></div></footer>
    </main>
  );
}

function Countdown({ ms }: { ms: number }) {
  const [left, setLeft] = useState(Math.ceil(ms / 1000));
  useEffect(() => {
    const start = Date.now();
    const t = window.setInterval(() => setLeft(Math.max(0, Math.ceil((ms - (Date.now() - start)) / 1000))), 200);
    return () => window.clearInterval(t);
  }, [ms]);
  return <>Voltando ao início em {left}s</>;
}
