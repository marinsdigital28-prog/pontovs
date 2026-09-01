"use client";

import React, { useEffect, useState } from 'react';

type PunchType = 'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO';

type TodayPunch = { id?: string; type: string; timestamp: string };

const TYPE_LABELS: Record<string, string> = {
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
  PENDENTE: 'Pendente',
};

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [step, setStep] = useState<'lookup' | 'register'>('lookup');
  const [matricula, setMatricula] = useState('');
  const [employee, setEmployee] = useState<any>(null);
  const [nextType, setNextType] = useState<PunchType | null>('ENTRADA');
  const [allowedTypes, setAllowedTypes] = useState<PunchType[]>(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
  const [suggestionReason, setSuggestionReason] = useState('');
  const [todayPunches, setTodayPunches] = useState<TodayPunch[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ type: string; timestamp: string; location?: { lat: number; lng: number } | null } | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const autoLookupRef = React.useRef('');
  const pendingClientIdRef = React.useRef<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [journeyClosed, setJourneyClosed] = useState(false);
  const [awaitingTypeConfirm, setAwaitingTypeConfirm] = useState(false);

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
    if (step !== 'register' || !employee || cameraOpen || photo || confirmation || loading || awaitingTypeConfirm) return;
    void handlePhotoSelection();
  }, [step, employee, cameraOpen, photo, confirmation, loading, awaitingTypeConfirm]);

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
    setAwaitingTypeConfirm(false);
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
          setAllowedTypes(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
          setSuggestionReason('Banco indisponível — escolha o tipo e salve no aparelho.');
          setTodayPunches([]);
          setStep('register');
          setStatusMsg('Banco indisponível. A câmera será aberta para salvar a marcação no aparelho e sincronizar depois.');
          return;
        }
        throw new Error(data.error || 'Matrícula não encontrada');
      }

      if (data.journeyClosed || !data.suggestedType && !data.nextType) {
        closeCamera();
        setEmployee(null);
        setNextType('ENTRADA');
        setAllowedTypes(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
        setTodayPunches(Array.isArray(data.todayPunches) ? data.todayPunches : []);
        setStep('lookup');
        setMatricula('');
        setPhoto(null);
        setConfirmation(null);
        autoLookupRef.current = '';
        setJourneyClosed(true);
        setStatusMsg(data.suggestionReason || 'Jornada encerrada — todas as marcações de hoje já foram registradas.');
        window.setTimeout(() => setJourneyClosed(false), 4500);
        return;
      }

      const suggested = (data.suggestedType || data.nextType) as PunchType;
      const allowed = (Array.isArray(data.allowedTypes) && data.allowedTypes.length
        ? data.allowedTypes
        : [suggested]) as PunchType[];

      setEmployee(data);
      setNextType(suggested);
      setAllowedTypes(allowed);
      setSuggestionReason(data.suggestionReason || '');
      setTodayPunches(Array.isArray(data.todayPunches) ? data.todayPunches : []);
      setStep('register');
      setStatusMsg(
        data.offlineFallback
          ? 'Funcionário reconhecido em contingência. Confirme o tipo e a foto.'
          : `Reconhecido. Sugerido: ${TYPE_LABELS[suggested] || suggested}.`,
      );
    } catch (err: any) {
      setStatusMsg(err?.message || 'Matrícula inválida');
    } finally {
      setLoading(false);
    }
  }

  function selectType(type: PunchType) {
    if (!nextType) {
      setNextType(type);
      setAwaitingTypeConfirm(false);
      return;
    }
    if (type === nextType) {
      setAwaitingTypeConfirm(false);
      return;
    }
    setNextType(type);
    setAwaitingTypeConfirm(true);
    setStatusMsg(`Você escolheu ${TYPE_LABELS[type]}. Confirme abaixo para continuar.`);
  }

  function confirmSelectedType() {
    setAwaitingTypeConfirm(false);
    setStatusMsg(`Tipo confirmado: ${TYPE_LABELS[nextType || ''] || nextType}. Preparando câmera...`);
  }

  function queueOfflinePunch(
    payload: { employeeNumber: string; clientTimestamp: string; clientId: string; photo: string | null; type?: string },
    reason: string,
  ) {
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
    if (!employee || !nextType) return;
    const payload = {
      employeeNumber: employee.employeeNumber,
      clientTimestamp: new Date().toISOString(),
      clientId:
        pendingClientIdRef.current ??
        (pendingClientIdRef.current = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      photo: photoOverride ?? photo ?? null,
      type: nextType,
    };
    if (employee.offline || employee.offlineFallback || !navigator.onLine) {
      queueOfflinePunch(
        payload,
        employee.offline || employee.offlineFallback
          ? 'Marcação salva no aparelho — será sincronizada assim que o banco voltar.'
          : 'Sem conexão — marcação protegida no aparelho e será sincronizada automaticamente',
      );
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
      pendingClientIdRef.current = null;
      setConfirmation({
        type: json.type,
        timestamp: json.timestamp,
      });
      const receiptStatus = json.receiptEmail?.status;
      setStatusMsg(
        receiptStatus === 'sent'
          ? 'Ponto registrado. Comprovante enviado para seu email.'
          : receiptStatus === 'not_configured'
            ? 'Ponto registrado. Comprovante pendente de configuração do email.'
            : receiptStatus === 'failed'
              ? 'Ponto registrado. Não foi possível enviar o comprovante por email.'
              : 'Ponto registrado e sincronizado. Preparando a próxima matrícula...',
      );
      window.setTimeout(() => resetForNextCollaborator(), 2200);
    } catch (err: any) {
      const errorMessage = err?.message || 'Não foi possível registrar a marcação. Tente novamente.';
      if (err?.code === 'DATABASE_QUOTA_EXCEEDED') {
        const pending = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
        pending.push(payload);
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
          const response = await fetch('/api/punch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(p),
          });
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
    const retryTimer = window.setInterval(() => {
      if (navigator.onLine) void sync();
    }, 60000);
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
    setAllowedTypes(['ENTRADA', 'INTERVALO', 'RETORNO', 'SAIDA']);
    setSuggestionReason('');
    setTodayPunches([]);
    setPhoto(null);
    setConfirmation(null);
    setStatusMsg(null);
    setJourneyClosed(false);
    setAwaitingTypeConfirm(false);
    autoLookupRef.current = '';
    pendingClientIdRef.current = null;
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
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      setCameraOpen(true);
      setStatusMsg(`Câmera pronta. Registrando como ${TYPE_LABELS[nextType || ''] || nextType}.`);
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
    canvas.width = 720;
    canvas.height = 720;
    canvas.getContext('2d')?.drawImage(video, sourceX, sourceY, size, size, 0, 0, 720, 720);
    const capturedPhoto = canvas.toDataURL('image/jpeg', 0.9);
    setPhoto(capturedPhoto);
    closeCamera();
    setStatusMsg('Foto capturada. Confirmando marcação...');
    await handlePunch(capturedPhoto);
  }

  function formatPunchTime(timestamp: string) {
    try {
      return new Date(timestamp).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '--:--';
    }
  }

  const otherTypes = allowedTypes.filter((type) => type !== nextType);

  return (
    <main className="container ponto-kiosk-container">
      <div className="header-row">
        <div>
          <div className="header-brand">Ponto Progredir</div>
          <div className="header-greeting">{employee ? `Olá, ${employee.name}` : 'Identificação do funcionário'}</div>
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
          <div className="ponto-reference-hint">
            👆 <strong>Digite seu número de matrícula</strong>
          </div>
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
              <div className="small-muted" style={{ marginBottom: 10, fontWeight: 700 }}>
                Digite sua matrícula
              </div>
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
                  <div className="smart-punch-panel" style={{ marginBottom: 14 }}>
                    <div className="small-muted" style={{ fontWeight: 700, marginBottom: 6 }}>
                      {employee.employeeNumber} · {employee.name}
                    </div>
                    {suggestionReason ? (
                      <div className="status-msg" style={{ marginBottom: 10 }}>
                        {suggestionReason}
                      </div>
                    ) : null}

                    <div className="small-muted" style={{ marginBottom: 6, fontWeight: 700 }}>
                      Recomendado agora
                    </div>
                    <button
                      type="button"
                      className="primary-btn"
                      style={{ width: '100%', marginBottom: 10 }}
                      onClick={() => nextType && selectType(nextType)}
                      disabled={!nextType}
                    >
                      {TYPE_LABELS[nextType || ''] || nextType || '—'}
                    </button>

                    {otherTypes.length > 0 && (
                      <>
                        <div className="small-muted" style={{ marginBottom: 6 }}>
                          Outras opções
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                          {otherTypes.map((type) => (
                            <button
                              key={type}
                              type="button"
                              className="ghost-btn"
                              onClick={() => selectType(type)}
                              style={{
                                flex: '1 1 30%',
                                minWidth: 90,
                                fontWeight: nextType === type ? 800 : 600,
                              }}
                            >
                              {TYPE_LABELS[type]}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {awaitingTypeConfirm && (
                      <button type="button" className="primary-btn" style={{ width: '100%', marginBottom: 12 }} onClick={confirmSelectedType}>
                        Confirmar {TYPE_LABELS[nextType || ''] || nextType}
                      </button>
                    )}

                    <div className="small-muted" style={{ marginBottom: 6, fontWeight: 700 }}>
                      Marcações de hoje
                    </div>
                    <div
                      style={{
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRadius: 12,
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,0.7)',
                      }}
                    >
                      {todayPunches.length === 0 ? (
                        <div className="small-muted">Nenhuma marcação ainda hoje.</div>
                      ) : (
                        todayPunches.map((punch, index) => (
                          <div
                            key={punch.id || `${punch.type}-${punch.timestamp}-${index}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 12,
                              padding: '4px 0',
                              borderTop: index ? '1px solid rgba(0,0,0,0.06)' : undefined,
                              fontWeight: 600,
                            }}
                          >
                            <span>{TYPE_LABELS[punch.type] || punch.type}</span>
                            <span className="small-muted">{formatPunchTime(punch.timestamp)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {!awaitingTypeConfirm &&
                    (cameraOpen ? (
                      <div className="camera-stage camera-stage-minimal">
                        <div className="camera-preview-large camera-preview-minimal">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                          />
                        </div>
                        <button
                          type="button"
                          className="primary-btn photo-action-btn"
                          onClick={() => void capturePhoto()}
                          disabled={loading}
                        >
                          {loading ? 'Registrando...' : `Marcar + Foto (${TYPE_LABELS[nextType || ''] || nextType || 'PONTO'})`}
                        </button>
                      </div>
                    ) : photo ? (
                      <div className="camera-stage camera-stage-minimal photo-retry-stage">
                        <img src={photo} alt="Foto capturada" className="camera-preview-large camera-preview-minimal" />
                        <button
                          type="button"
                          className="primary-btn photo-action-btn"
                          onClick={() => void handlePunch(photo)}
                          disabled={loading}
                        >
                          {loading ? 'Registrando...' : 'Tentar registrar novamente'}
                        </button>
                      </div>
                    ) : (
                      <div className="camera-stage camera-stage-minimal">
                        <div className="status-msg">{statusMsg || 'Câmera indisponível. Toque para tentar novamente.'}</div>
                        <button
                          type="button"
                          className="primary-btn photo-action-btn"
                          onClick={() => void handlePhotoSelection()}
                          disabled={loading}
                        >
                          Abrir câmera
                        </button>
                      </div>
                    ))}
                </>
              ) : (
                <div className="summary confirmation-summary confirmation-minimal" role="status" aria-live="polite">
                  <div className="confirmation-animation" aria-hidden="true">
                    <span className="confirmation-ball">
                      <span className="confirmation-check">✓</span>
                    </span>
                  </div>
                  <div className="confirmation-title">
                    {confirmation.type === 'PENDENTE' ? 'MARCAÇÃO SALVA OFFLINE' : 'MARCAÇÃO CONFIRMADA'}
                  </div>
                  <div className="confirmation-name">{employee.name}</div>
                  <div className="confirmation-type">
                    {confirmation.type === 'PENDENTE'
                      ? 'Aguardando sincronização'
                      : `${TYPE_LABELS[confirmation.type] || confirmation.type} · ${new Date(confirmation.timestamp).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
                  </div>
                  {photo && <img src={photo} alt="Foto registrada" className="photo-confirmation-large" />}
                </div>
              )}
              {statusMsg && !confirmation && <div className="status-msg minimal-status">{statusMsg}</div>}
              {!confirmation && (
                <button type="button" className="ghost-btn" style={{ marginTop: 12, width: '100%' }} onClick={resetForNextCollaborator}>
                  Trocar matrícula
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
