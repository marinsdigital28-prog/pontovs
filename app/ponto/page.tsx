"use client";

import React, { useEffect, useState } from 'react';

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [step, setStep] = useState<'lookup' | 'register'>('lookup');
  const [matricula, setMatricula] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [nextType, setNextType] = useState<'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO' | null>('ENTRADA');
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ type: string; timestamp: string; location?: { lat: number; lng: number } | null } | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const autoLookupRef = React.useRef('');
  const pendingClientIdRef = React.useRef<string | null>(null);
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
          setStatusMsg('Banco indisponível. Toque em “Abrir câmera” para salvar a marcação no aparelho e sincronizar depois.');
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
        ? 'Funcionário reconhecido em contingência. Toque em “Abrir câmera” para salvar a saída neste aparelho e sincronizar quando o banco voltar.'
        : `Funcionário reconhecido. Toque em “Abrir câmera” para ${recognizedNextType}.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Matrícula inválida');
    } finally {
      setLoading(false);
    }
  }

  function queueOfflinePunch(payload: { employeeNumber: string; clientTimestamp: string; clientId: string; photo: string | null }, reason: string) {
    const offline = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
    offline.push(payload);
    localStorage.setItem('offlinePunches', JSON.stringify(offline));
    pendingClientIdRef.current = null;
    setConfirmation({ type: 'PENDENTE', timestamp: payload.clientTimestamp });
    setStatusMsg(reason);
    setLoading(false);
    window.setTimeout(() => resetForNextCollaborator(), 2200);
  }

  async function handlePunch(photoOverride?: string | null) {
    if (!employee) return;
    const payload = {
      employeeNumber: employee.employeeNumber,
      clientTimestamp: new Date().toISOString(),
      clientId: pendingClientIdRef.current ?? (pendingClientIdRef.current = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      photo: photoOverride ?? photo ?? null,
    };
    if (employee.offline || employee.offlineFallback || !navigator.onLine) {
      queueOfflinePunch(payload, employee.offline || employee.offlineFallback
        ? 'Marcação salva no aparelho — será sincronizada assim que o banco voltar.'
        : 'Sem conexão — marcação protegida no aparelho e será sincronizada automaticamente');
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
      });
      setStatusMsg('Ponto registrado e sincronizado. Preparando a próxima matrícula...');
      window.setTimeout(() => resetForNextCollaborator(), 2200);
    } catch (err: any) {
      const errorMessage = err?.message || 'Não foi possível registrar a marcação. Tente novamente.';
      if (err?.code === 'DATABASE_QUOTA_EXCEEDED') {
        const pending = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
        pending.push(payload);
        localStorage.setItem('offlinePunches', JSON.stringify(pending));
        setStatusMsg('Saída salva neste aparelho e aguardando sincronização quando o banco for liberado.');
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
        queueOfflinePunch(payload, 'Sem conexão — salvo localmente e será reenviado quando online');
      } else {
        setStatusMsg(errorMessage);
      }
    } finally {
      setLoading(false);
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
          const response = await fetch('/api/punch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
          if (!response.ok && response.status !== 409) remaining.push(p);
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

  const dayString = now ? now.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const timeString = now ? now.toLocaleTimeString() : '--:--:--';

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
    setStatusMsg('Solicitando câmera frontal...');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMsg('Este navegador não permite câmera interna. Abra o endereço em HTTPS no celular.');
      return;
    }
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false });
      setCameraOpen(true);
      setStatusMsg('Câmera pronta. Posicione o rosto no quadrado e toque em Registrar ponto.');
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
    const capturedPhoto = canvas.toDataURL('image/jpeg', 0.78);
    setPhoto(capturedPhoto);
    closeCamera();
    setStatusMsg('Foto capturada. Confirmando marcação...');
    await handlePunch(capturedPhoto);
  }

  return (
    <main className="container ponto-kiosk-container">
      <div className="header-row">
        <div>
          <div className="header-brand">Ponto Progredir</div>
          <div className="header-greeting">{employee ? `Bom dia, ${employee.name}` : 'Identificação do funcionário'}</div>
        </div>
        <div className="avatar" aria-hidden />
      </div>

      <div className={`card ponto-kiosk-card ${step === 'register' ? 'ponto-register-card' : 'ponto-lookup-card'}`}>
        <section className="ponto-info-panel">
        <div className="clock">
          <div className="time">{timeString}</div>
          <div className="date">{dayString}</div>
        </div>
        <div className="ponto-info-divider" />
        <div className="ponto-reference-hint">👆 <strong>Digite seu número de matrícula</strong></div>
        <div className="ponto-info-meta">Ponto Eletrônico Homologado · Portaria 671 MTE</div>
        </section>
        <section className="ponto-input-panel">

        {step === 'lookup' && (
          <div className="lookup-stage">
            {journeyClosed && statusMsg && (
              <div className="journey-closed-notice" role="status">
                <strong>Jornada encerrada</strong>
                <span>{statusMsg}</span>
              </div>
            )}
            <div className="small-muted" style={{ marginBottom: 10, fontWeight: 700 }}>Digite sua matrícula</div>
            <div className="matricula-shell">
              <div className="matricula-label">MATRÍCULA</div>
              <div className="matricula-display">{matricula || '—'}</div>
            </div>

            <div className="keypad-grid">
              {keypadNumbers.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="keypad-btn"
                  onClick={() => appendDigit(key)}
                  aria-label={key === 'C' ? 'Limpar matrícula' : key === '⌫' ? 'Apagar último dígito' : `Tecla ${key}`}
                >
                  {key}
                </button>
              ))}
            </div>

            <button className="primary-btn" style={{ marginTop: 18 }} onClick={handleLookup} disabled={loading || !matricula.trim()}>
              {loading ? 'Buscando...' : 'Continuar'}
            </button>
            {statusMsg && !journeyClosed && <div className="status-msg">{statusMsg}</div>}
          </div>
        )}

        {step === 'register' && employee && (
          <div className="register-stage register-stage-minimal">
            {!confirmation ? (
              <>
                {cameraOpen ? (
                  <div className="camera-stage camera-stage-minimal">
                    <div className="camera-preview-large camera-preview-minimal">
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    </div>
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void capturePhoto()} disabled={loading}>
                      {loading ? 'Registrando...' : `Marcar + Foto (${nextType || 'PONTO'})`}
                    </button>
                  </div>
                ) : photo ? (
                  <div className="camera-stage camera-stage-minimal photo-retry-stage">
                    <img src={photo} alt="Foto capturada" className="camera-preview-large camera-preview-minimal" />
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void handlePunch(photo)} disabled={loading}>
                      {loading ? 'Registrando...' : 'Tentar registrar novamente'}
                    </button>
                  </div>
                ) : (
                  <div className="camera-stage camera-stage-minimal">
                    <div className="status-msg">{statusMsg || 'Câmera indisponível. Toque para tentar novamente.'}</div>
                    <button type="button" className="primary-btn photo-action-btn" onClick={() => void handlePhotoSelection()} disabled={loading}>Abrir câmera</button>
                  </div>
                )}
              </>
            ) : (
              <div className="summary confirmation-summary confirmation-minimal" role="status" aria-live="polite">
                <div className="confirmation-animation" aria-hidden="true"><span className="confirmation-ball"><span className="confirmation-check">✓</span></span></div>
                <div className="confirmation-title">{confirmation.type === 'PENDENTE' ? 'MARCAÇÃO SALVA OFFLINE' : 'MARCAÇÃO CONFIRMADA'}</div>
                <div className="confirmation-name">{employee.name}</div>
                <div className="confirmation-type">{confirmation.type === 'PENDENTE' ? 'Aguardando sincronização' : `${confirmation.type} · ${new Date(confirmation.timestamp).toLocaleTimeString()}`}</div>
                {photo && <img src={photo} alt="Foto registrada" className="photo-confirmation-large" />}
              </div>
            )}
            {statusMsg && !confirmation && <div className="status-msg minimal-status">{statusMsg}</div>}
          </div>
        )}

        </section>
      </div>
    </main>
  );
}
