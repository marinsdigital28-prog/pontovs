"use client";

import React, { useEffect, useState } from 'react';
import InstallAppButton from '../../components/InstallAppButton';
import './totem.css';

const TZ = 'America/Sao_Paulo';
/** Tempo que a tela de sucesso fica visível antes de voltar sozinha para a próxima matrícula. */
const SUCCESS_SCREEN_MS = 4000;
const TYPE_LABEL: Record<string, string> = { ENTRADA: 'Entrada', INTERVALO: 'Saída para intervalo', RETORNO: 'Retorno do intervalo', SAIDA: 'Saída', PENDENTE: 'Salva no aparelho' };
const TYPE_ICON: Record<string, string> = { ENTRADA: '→', INTERVALO: '☕', RETORNO: '↩', SAIDA: '←', PENDENTE: '⟳' };
function greeting(date: Date | null) { const h = date ? Number(date.toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ })) : 8; return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
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

  const keypadNumbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

  function appendDigit(nextValue: string) {
    if (nextValue === 'C') {
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
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
    }, 450);
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

  const dayString = now ? now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }) : '';
  const timeString = now ? now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: TZ }) : '--:--:--';
  const [hhmm, ss] = [timeString.slice(0, 5), timeString.slice(6, 8)];

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
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); appendDigit(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); appendDigit('⌫'); }
      else if (e.key === 'Escape' || e.key === 'Delete') { e.preventDefault(); appendDigit('C'); }
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

  return (
    <main className={`container ponto-kiosk-container totem totem-step-${confirmation ? 'done' : step}`}>
      <div className="header-row totem-header">
        <div>
          <div className="header-brand">Ponto Progredir</div>
          <div className="header-greeting">{employee ? `${greeting(now)}, ${employee.name}` : 'Identificação do funcionário'}</div>
        </div>
        <div className="ponto-header-actions"><InstallAppButton compact /><div className="avatar" aria-hidden /></div>
      </div>

      <div className={`card ponto-kiosk-card ${step === 'register' ? 'ponto-register-card' : 'ponto-lookup-card'}`}>
        <section className="ponto-info-panel" aria-label="Data e hora">
          <div className="clock totem-clock">
            <div className="time" aria-live="off"><span className="totem-hhmm">{hhmm}</span><span className="totem-ss">{ss}</span></div>
            <div className="date">{dayString}</div>
          </div>
          <div className="ponto-info-divider" />
          {step === 'register' && employee ? (
            <div className="totem-who" key={employee.employeeNumber}>
              <span className="totem-who-label">Matrícula {employee.employeeNumber}</span>
              <strong className="totem-who-name">{employee.name}</strong>
              {nextType && !confirmation ? <span className={`totem-next totem-type-${nextType}`}><span aria-hidden>{TYPE_ICON[nextType]}</span> Próxima marcação: {typeLabel(nextType)}</span> : null}
            </div>
          ) : (
            <div className="ponto-reference-hint"><span aria-hidden>👆</span> <strong>Digite seu número de matrícula</strong><small className="totem-kbd-hint">Toque nos números ou use o teclado · Enter para continuar</small></div>
          )}
          <div className="ponto-info-meta">Ponto Eletrônico Homologado · Portaria 671 MTE</div>
        </section>
        <section className="ponto-input-panel">

        {step === 'lookup' && (
          <div className="lookup-stage totem-fade">
            {journeyClosed && statusMsg && (
              <div className="journey-closed-notice" role="status">
                <strong>Jornada encerrada</strong>
                <span>{statusMsg}</span>
              </div>
            )}
            <div className="small-muted totem-label" id="totem-mat-label">Digite sua matrícula</div>
            <div className={`matricula-shell ${matricula ? 'has-value' : ''} ${loading ? 'is-loading' : ''}`} aria-labelledby="totem-mat-label">
              <div className="matricula-label">MATRÍCULA</div>
              <div className="matricula-display" aria-live="polite" aria-label={matricula ? `Matrícula ${matricula.split('').join(' ')}` : 'Nenhum dígito'}>
                {matricula ? matricula.split('').map((d, i) => <span key={`${i}-${d}`} className="totem-digit">{d}</span>) : <span className="totem-placeholder">—</span>}
                {loading ? <span className="totem-spinner" aria-hidden /> : null}
              </div>
            </div>

            <div className="keypad-grid" role="group" aria-label="Teclado numérico">
              {keypadNumbers.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`keypad-btn ${key === 'C' || key === '⌫' ? 'keypad-btn-fn' : ''}`}
                  onClick={() => appendDigit(key)}
                  aria-label={key === 'C' ? 'Limpar matrícula' : key === '⌫' ? 'Apagar último dígito' : `Tecla ${key}`}
                >
                  {key}
                </button>
              ))}
            </div>

            <button className="primary-btn totem-continue" style={{ marginTop: 18 }} onClick={handleLookup} disabled={loading || !matricula.trim()}>
              {loading ? 'Buscando...' : 'Continuar'}
            </button>
            {statusMsg && !journeyClosed && <div className="status-msg" role="status">{statusMsg}</div>}
          </div>
        )}

        {step === 'register' && employee && (
          <div className="register-stage register-stage-minimal">
            {!confirmation ? (
              <>
                {cameraOpen ? (
                  <div className="camera-stage camera-stage-minimal totem-fade">
                    <div className="camera-preview-large camera-preview-minimal totem-camera">
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                      <span className="totem-camera-ring" aria-hidden />
                    </div>
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void capturePhoto()} disabled={loading}>
                      {loading ? 'Registrando...' : 'Marcar ponto'}
                    </button>
                  </div>
                ) : photo ? (
                  <div className="camera-stage camera-stage-minimal photo-retry-stage totem-fade">
                    <img src={photo} alt="Foto capturada" className="camera-preview-large camera-preview-minimal" />
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void handlePunch(photo)} disabled={loading}>
                      {loading ? 'Registrando...' : 'Tentar registrar novamente'}
                    </button>
                  </div>
                ) : (
                  <div className="camera-stage camera-stage-minimal totem-fade">
                    <div className="status-msg">{statusMsg || 'Câmera indisponível. Toque para tentar novamente.'}</div>
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void handlePhotoSelection()} disabled={loading}>Abrir câmera</button>
                  </div>
                )}
              </>
            ) : (
              <div className={`summary confirmation-summary confirmation-summary-minimal totem-success totem-type-${confirmation.type}`} role="status" aria-live="assertive">
                <div className="confirmation-check" aria-hidden>
                  <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
                </div>
                <div className="confirmation-title">{confirmation.type === 'PENDENTE' ? 'Marcação salva' : confirmation.duplicate ? 'Já registrado' : 'Ponto registrado'}</div>
                <div className="totem-receipt">
                  <div><span>Colaborador</span><strong>{employee.name}</strong></div>
                  <div><span>Tipo</span><strong className="confirmation-type">{typeLabel(confirmation.type)}</strong></div>
                  <div><span>Horário</span><strong className="confirmation-time">{confirmedAt ? confirmedAt.toLocaleTimeString('pt-BR', { hourCycle: 'h23', timeZone: TZ }) : '—'}</strong></div>
                  <div><span>Data</span><strong>{confirmedAt ? confirmedAt.toLocaleDateString('pt-BR', { timeZone: TZ }) : '—'}</strong></div>
                  {confirmation.id ? <div><span>Registro</span><strong className="totem-mono">{confirmation.id.slice(-10).toUpperCase()}</strong></div> : null}
                </div>
                <button type="button" className="ghost-btn totem-next-btn" onClick={() => resetForNextCollaborator()}>
                  Próximo colaborador
                  <span className="totem-countdown" style={{ animationDuration: `${SUCCESS_SCREEN_MS}ms` }} aria-hidden />
                </button>
              </div>
            )}
            {statusMsg && <div className="status-msg" role="status">{statusMsg}</div>}
          </div>
        )}
        </section>
      </div>
    </main>
  );
}
