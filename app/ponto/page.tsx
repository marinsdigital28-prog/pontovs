"use client";

import React, { useEffect, useState } from 'react';

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<'unknown' | 'getting' | 'valid' | 'failed'>('unknown');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [lastPunch, setLastPunch] = useState<any>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [step, setStep] = useState<'lookup' | 'register'>('lookup');
  const [matricula, setMatricula] = useState('4041');
  const [employee, setEmployee] = useState<any>(null);
  const [selectedType, setSelectedType] = useState<'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO'>('ENTRADA');
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ type: string; timestamp: string; location?: { lat: number; lng: number } | null } | null>(null);
  const photoInputRef = React.useRef<HTMLInputElement | null>(null);

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

  async function acquireLocation() {
    setLocationState('getting');
    setStatusMsg('Obtendo localização...');
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!('geolocation' in navigator)) return reject(new Error('Geolocation not supported'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(coords);
      setLocationState('valid');
      setStatusMsg('Localização validada');
      return coords;
    } catch (err: any) {
      setLocation(null);
      setLocationState('failed');
      setStatusMsg(err?.message || 'Não foi possível validar sua localização');
      return null;
    }
  }

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
      setEmployee(data);
      setStep('register');
      setStatusMsg('Funcionário reconhecido');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Matrícula inválida');
    } finally {
      setLoading(false);
    }
  }

  async function handlePunch() {
    if (!employee) return;
    setLoading(true);
    setStatusMsg('Capturando localização e registrando ponto...');
    const coords = await acquireLocation();
    const payload = {
      type: selectedType,
      employeeNumber: employee.employeeNumber,
      timestamp: new Date().toISOString(),
      clientTimestamp: new Date().toISOString(),
      clientId: crypto?.randomUUID?.() ?? `${Date.now()}`,
      photo: photo || null,
      location: coords ? { lat: coords.lat, lng: coords.lng } : null,
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
      setConfirmation({
        type: payload.type,
        timestamp: payload.timestamp,
        location: payload.location ?? null,
      });
      setStatusMsg('Ponto registrado e sincronizado');
    } catch (err: any) {
      const offline = JSON.parse(localStorage.getItem('offlinePunches') || '[]');
      offline.push(payload);
      localStorage.setItem('offlinePunches', JSON.stringify(offline));
      setStatusMsg('Sem conexão — salvo localmente e será reenviado quando online');
      setLocationState(location ? 'valid' : 'failed');
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

  function handlePhotoTypeSelection(option: 'ENTRADA' | 'SAIDA' | 'INTERVALO' | 'RETORNO') {
    setSelectedType(option);
    setPhoto(null);
    setConfirmation(null);
    setStatusMsg('Abrindo câmera do dispositivo...');
    setTimeout(() => {
      photoInputRef.current?.click();
    }, 180);
  }

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result));
      setStatusMsg('Foto capturada. Localização e registro em andamento...');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
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
                  <div className="small-muted" style={{ marginBottom: 8, fontWeight: 700 }}>Tipo de marcação</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {(['ENTRADA', 'SAIDA', 'INTERVALO', 'RETORNO'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handlePhotoTypeSelection(option)}
                        style={{
                          width: '100%',
                          padding: '11px 12px',
                          borderRadius: 10,
                          border: selectedType === option ? '1px solid rgba(212, 175, 55, 0.9)' : '1px solid var(--border)',
                          background: selectedType === option ? 'rgba(212, 175, 55, 0.12)' : 'rgba(255,255,255,0.02)',
                          color: 'var(--text)',
                          fontWeight: 700,
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="input"
                    onChange={handlePhotoChange}
                    style={{ display: 'none' }}
                  />
                </div>

                {photo && (
                  <>
                    <div style={{ marginTop: 16 }}>
                      <div className="small-muted" style={{ marginBottom: 8, fontWeight: 700 }}>Foto confirmada</div>
                      <img src={photo} alt="Foto do usuário" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12 }} />
                    </div>

                    <div className="location-row" style={{ marginTop: 16 }}>
                      <div>
                        <div className="location-title">{locationState === 'valid' ? '📍 Localização' : locationState === 'getting' ? '📍 Obtendo localização...' : locationState === 'failed' ? '📍 Erro de localização' : '📍 Localização'}</div>
                        <div className="location-sub">{locationState === 'valid' ? 'Localização validada' : locationState === 'getting' ? 'Aguardando confirmação...' : locationState === 'failed' ? (statusMsg || 'Falha ao validar') : 'Verificação pendente'}</div>
                      </div>
                      <div className="location-dot">
                        {locationState === 'valid' && <span style={{color:'var(--success)'}}>●</span>}
                        {locationState === 'getting' && <span style={{color:'var(--warn)'}}>●</span>}
                        {locationState === 'failed' && <span style={{color:'var(--error)'}}>●</span>}
                        {locationState === 'unknown' && <span style={{color:'var(--muted)'}}>●</span>}
                      </div>
                    </div>

                    <button className="primary-btn" style={{ marginTop: 16 }} onClick={handlePunch} disabled={loading}>
                      {loading ? 'Processando...' : 'BATER PONTO'}
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
                {confirmation.location && (
                  <div className="small-muted" style={{ marginTop: 6 }}>Geolocalização: {confirmation.location.lat.toFixed(4)}, {confirmation.location.lng.toFixed(4)}</div>
                )}
                {photo && (
                  <img src={photo} alt="Foto registrada" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginTop: 12 }} />
                )}
              </div>
            )}
            {statusMsg && <div className="status-msg">{statusMsg}</div>}

            <button type="button" className="small-muted" style={{ marginTop: 12, background: 'transparent', border: 'none', padding: 0, color: 'var(--gold)', fontWeight: 700 }} onClick={() => { setStep('lookup'); setEmployee(null); setStatusMsg(null); setConfirmation(null); setPhoto(null); }}>
              Voltar para matrícula
            </button>
          </div>
        )}

        {lastPunch && !confirmation && (
          <div className="summary" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, color: 'var(--gold)' }}>Último registro</div>
            <div style={{ marginTop: 6 }}>{lastPunch.type} • {new Date(lastPunch.timestamp).toLocaleTimeString()}</div>
            {lastPunch.location && (
              <div className="small-muted">{lastPunch.location.lat.toFixed(4)}, {lastPunch.location.lng.toFixed(4)}</div>
            )}
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
