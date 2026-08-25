"use client";

import React, { useEffect, useState } from 'react';

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
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
  const [cameraOpen, setCameraOpen] = useState(false);

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
    const saved = localStorage.getItem('lastPunch');
    if (saved) setLastPunch(JSON.parse(saved));
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
    try {
      const r = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeNumber: matricula.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Matrícula não encontrada');
      const recognizedNextType = data.nextType || 'ENTRADA';
      setEmployee(data);
      setNextType(recognizedNextType);
      setStep('register');
      setStatusMsg(`Funcionário reconhecido. Abrindo a câmera para ${recognizedNextType}...`);
      window.setTimeout(() => { void handlePhotoSelection(); }, 120);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Matrícula inválida');
    } finally {
      setLoading(false);
    }
  }

  async function handlePunch() {
    if (!employee) return;
    setLoading(true);
    setStatusMsg('Registrando ponto com foto...');
    const payload = {
      employeeNumber: employee.employeeNumber,
      clientTimestamp: new Date().toISOString(),
      clientId: crypto?.randomUUID?.() ?? `${Date.now()}`,
      photo: photo || null,
    };

    try {
      const r = await fetch('/api/punch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || 'Erro ao registrar ponto');
      localStorage.setItem('lastPunch', JSON.stringify(json));
      setLastPunch(json);
      setNextType(nextAfter(json.type));
      setConfirmation({
        type: json.type,
        timestamp: json.timestamp,
      });
      setStatusMsg('Ponto registrado e sincronizado. Preparando a próxima matrícula...');
      window.setTimeout(() => resetForNextCollaborator(), 2200);
    } catch (err: any) {
      const offline = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
      offline.push(payload);
      localStorage.setItem('offlinePunches', JSON.stringify(offline));
      setStatusMsg('Sem conexão — salvo localmente e será reenviado quando online');
    } finally {
      setLoading(false);
      if (!confirmation) {
        setTimeout(() => setStatusMsg(null), 5000);
      }
    }
  }

  useEffect(() => {
    const sync = async () => {
      const pending = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
      if (!pending || pending.length === 0) return;
      for (const p of pending) {
        try {
          await fetch('/api/punch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
        } catch {
          return;
        }
      }
      localStorage.removeItem('offlinePunches');
      setStatusMsg('Pendentes sincronizados');
      setTimeout(() => setStatusMsg(null), 3000);
    };
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
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
    autoLookupRef.current = '';
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

  function capturePhoto() {
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
    setPhoto(canvas.toDataURL('image/jpeg', 0.82));
    closeCamera();
    setStatusMsg('Foto capturada. Toque em Registrar ponto para confirmar.');
  }

  return (
    <main className="container">
      <div className="header-row">
        <div>
          <div className="header-brand">Ponto Progredir</div>
          <div className="header-greeting">{employee ? `Bom dia, ${employee.name}` : 'Identificação do funcionário'}</div>
        </div>
        <div className="avatar" aria-hidden />
      </div>

      <div className="card">
        <div className="clock">
          <div className="time">{timeString}</div>
          <div className="date">{dayString}</div>
        </div>

        {step === 'lookup' && (
          <div style={{ marginTop: 18 }}>
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
            {statusMsg && <div className="status-msg">{statusMsg}</div>}
          </div>
        )}

        {step === 'register' && employee && (
          <div style={{ marginTop: 18 }}>
            <div className="summary" style={{ marginTop: 0 }}>
              <div style={{ fontWeight: 800, color: 'var(--gold)' }}>Funcionário reconhecido</div>
              <div style={{ marginTop: 6, fontSize: '1.05rem', fontWeight: 700 }}>{employee.name}</div>
              <div className="small-muted" style={{ marginTop: 4 }}>Matrícula: {employee.employeeNumber}</div>
            </div>

            {!confirmation && (
              <>
                <div style={{ marginTop: 16 }}>
                  <div className="small-muted" style={{ marginBottom: 8, fontWeight: 700 }}>Próxima batida</div>
                  <div className="summary" style={{ marginTop: 0, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.35rem', fontWeight: 800, color: nextType ? 'var(--gold)' : 'var(--success)' }}>
                      {nextType || 'Jornada encerrada'}
                    </div>
                    <div className="small-muted" style={{ marginTop: 6 }}>
                      O sistema define automaticamente a sequência da jornada.
                    </div>
                  </div>
                  {nextType && (
                    <button type="button" className="primary-btn" style={{ marginTop: 12 }} onClick={handlePhotoSelection}>
                      Tirar foto para {nextType}
                    </button>
                  )}
                </div>

                {cameraOpen && (
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <div className="small-muted" style={{ marginBottom: 8, fontWeight: 700 }}>Câmera frontal</div>
                    <div className="camera-preview-large">
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    </div>
                    <div className="small-muted" style={{ marginTop: 8 }}>Mantenha o rosto centralizado</div>
                    <button type="button" className="primary-btn" style={{ marginTop: 12 }} onClick={capturePhoto}>Registrar ponto</button>
                    <button type="button" className="small-muted" style={{ marginTop: 8, background: 'transparent', border: 'none', padding: 0 }} onClick={closeCamera}>Cancelar câmera</button>
                  </div>
                )}

                {photo && !cameraOpen && (
                  <>
<div className="photo-confirmed-block">
                  <div className="small-muted" style={{ marginBottom: 8, fontWeight: 700 }}>Foto confirmada</div>
                      <img src={photo} alt="Foto do usuário" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12 }} />
                    </div>

                    <div className="location-row" style={{ marginTop: 16 }}>
                      <div>
                      <div className="location-title">📷 Evidência fotográfica</div>
                      <div className="location-sub">Foto capturada e pronta para validação do registro</div>
                      </div>
                      <div className="location-dot">
                        <span style={{color:'var(--success)'}}>●</span>
                      </div>
                    </div>

                    <button className="primary-btn" style={{ marginTop: 16 }} onClick={handlePunch} disabled={loading}>
                      {loading ? 'Processando...' : 'REGISTRAR PONTO'}
                    </button>
                  </>
                )}
              </>
            )}

            {confirmation && (
              <div className="summary" style={{ marginTop: 16, borderColor: 'rgba(46,211,138,0.5)', background: 'rgba(46,211,138,0.08)' }}>
                <div style={{ fontWeight: 800, color: 'var(--success)' }}>✓ Ponto registrado</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>Tipo: {confirmation.type}</div>
                <div className="small-muted" style={{ marginTop: 4 }}>{new Date(confirmation.timestamp).toLocaleTimeString()} • {new Date(confirmation.timestamp).toLocaleDateString()}</div>

                {photo && (
                  <img src={photo} alt="Foto registrada" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginTop: 12 }} />
                )}
              </div>
            )}
            {statusMsg && <div className="status-msg">{statusMsg}</div>}

            <button type="button" className="small-muted" style={{ marginTop: 12, background: 'transparent', border: 'none', padding: 0, color: 'var(--gold)', fontWeight: 700 }} onClick={resetForNextCollaborator}>
              Voltar para matrícula
            </button>
          </div>
        )}

        {lastPunch && !confirmation && (
          <div className="summary" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, color: 'var(--gold)' }}>Último registro</div>
            <div style={{ marginTop: 6 }}>{lastPunch.type} • {new Date(lastPunch.timestamp).toLocaleTimeString()}</div>
          </div>
        )}
      </div>

      <div className="bottom-nav">
        <div className="nav-inner">
          <button className="active">🏠 Início</button>
          <button>🕐 Registros</button>
          <button>📄 Folha</button>
          <button>👤 Perfil</button>
        </div>
      </div>
    </main>
  );
}
