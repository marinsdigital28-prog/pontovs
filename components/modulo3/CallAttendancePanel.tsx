'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CALL_PROGRAMS,
  getDateDayCode,
  type AttendanceMarkStatus,
  type AttendanceSession,
  type CallAssignment,
} from '@/lib/call-assignments';

type Participant = { id: string; nome: string; codigo?: string | number | null; turma?: string };
type Props = { fullPage?: boolean };

const statusOptions: Array<{ key: AttendanceMarkStatus; label: string; short: string }> = [
  { key: 'presente', label: 'Presente', short: 'P' },
  { key: 'falta', label: 'Falta', short: 'F' },
  { key: 'justificado', label: 'Justificado', short: 'J' },
  { key: 'nao_compareceu', label: 'Não compareceu', short: 'N' },
];

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assignmentLabel(item: CallAssignment) {
  const program = CALL_PROGRAMS.find((programItem) => programItem.value === item.program)?.label || item.program;
  const activity = item.kind === 'GENERAL' ? 'Chamada geral' : item.activity || 'Atividade';
  const shift = item.shift === 'MANHA' ? 'Manhã' : 'Tarde';
  return `${activity} · ${program} · ${item.turmaName || 'Turma cadastrada'} · ${shift} · ${item.slot}º horário`;
}

export default function CallAttendancePanel({ fullPage = false }: Props) {
  const [date, setDate] = useState(todayInSaoPaulo);
  const [assignments, setAssignments] = useState<CallAssignment[]>([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [missingBirthDate, setMissingBirthDate] = useState(0);
  const [writeAllowed, setWriteAllowed] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [loadingCall, setLoadingCall] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const weekday = getDateDayCode(date);
  const dayAssignments = useMemo(
    () => assignments.filter((item) => item.active && weekday && item.days.includes(weekday)),
    [assignments, weekday],
  );
  const selectedAssignment = dayAssignments.find((item) => item.id === assignmentId) || null;
  const visible = useMemo(() => participants.filter((item) =>
    !search.trim()
      || item.nome.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))
      || String(item.codigo || '').includes(search.trim()),
  ), [participants, search]);
  const marks = session?.marks || {};
  const counts = useMemo(() => ({
    presente: participants.filter((item) => marks[item.id] === 'presente').length,
    falta: participants.filter((item) => marks[item.id] === 'falta').length,
    justificado: participants.filter((item) => marks[item.id] === 'justificado').length,
    nao_compareceu: participants.filter((item) => marks[item.id] === 'nao_compareceu').length,
    pendente: participants.filter((item) => !marks[item.id]).length,
  }), [participants, marks]);

  const loadAssignments = useCallback(async () => {
    setLoadingAssignments(true);
    setError('');
    try {
      const response = await fetch('/api/modulo-3/chamada/assignments', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os vínculos do perfil.');
      const list: CallAssignment[] = Array.isArray(data.assignments) ? data.assignments : [];
      setAssignments(list);
      setWriteAllowed(data.writeAllowed !== false);
      setAssignmentId((current) => list.some((item) => item.id === current) ? current : '');
    } catch (loadError) {
      setAssignments([]);
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os vínculos do perfil.');
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  const loadCall = useCallback(async (id: string, callDate: string) => {
    if (!id) {
      setParticipants([]);
      setSession(null);
      return;
    }
    setLoadingCall(true);
    setError('');
    setMessage('');
    try {
      const params = new URLSearchParams({ assignmentId: id, date: callDate });
      const response = await fetch(`/api/modulo-3/chamada?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar a lista de chamada.');
      setParticipants(Array.isArray(data.participants) ? data.participants : []);
      setSession(data.session || null);
      setMissingBirthDate(Number(data.missingBirthDate) || 0);
    } catch (loadError) {
      setParticipants([]);
      setSession(null);
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a lista de chamada.');
    } finally {
      setLoadingCall(false);
    }
  }, []);

  useEffect(() => { void loadAssignments(); }, [loadAssignments]);
  useEffect(() => {
    if (!assignmentId || !dayAssignments.some((item) => item.id === assignmentId)) {
      setParticipants([]);
      setSession(null);
      return;
    }
    void loadCall(assignmentId, date);
  }, [assignmentId, date, dayAssignments, loadCall]);

  async function mark(item: Participant, status: AttendanceMarkStatus) {
    if (!selectedAssignment || savingId || !writeAllowed) return;
    const previous = session;
    setSavingId(item.id);
    setMessage('Salvando presença…');
    setError('');
    try {
      const response = await fetch('/api/modulo-3/chamada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, assignmentId: selectedAssignment.id, beneficiaryId: item.id, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível sincronizar a presença.');
      setSession(data.session || null);
      setMissingBirthDate(Number(data.missingBirthDate) || 0);
      setMessage(`Presença de ${item.nome} sincronizada.`);
    } catch (saveError) {
      setSession(previous);
      setError(saveError instanceof Error ? saveError.message : 'Falha ao sincronizar a presença.');
      setMessage('');
    } finally {
      setSavingId('');
    }
  }

  const panel = (
    <section className={`call-attendance-panel${fullPage ? ' full-page' : ''}`}>
      <div className="call-attendance-heading">
        <div>
          <span className="call-attendance-eyebrow">MÓDULO 3 · PRESENÇAS</span>
          <h2>Chamada da turma</h2>
          <p>Somente as turmas e atividades vinculadas ao seu perfil aparecem aqui.</p>
        </div>
        <button type="button" className="call-attendance-refresh" onClick={() => void loadAssignments()} disabled={loadingAssignments} aria-label="Atualizar vínculos">↻</button>
      </div>

      <div className="call-attendance-controls">
        <label><span>Data</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setAssignmentId(''); }} /></label>
        <label className="call-attendance-assignment"><span>Turma / atividade atribuída</span>
          <select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} disabled={loadingAssignments || dayAssignments.length === 0}>
            <option value="">{loadingAssignments ? 'Carregando vínculos…' : dayAssignments.length ? 'Selecione uma chamada' : 'Nenhuma chamada atribuída nesta data'}</option>
            {dayAssignments.map((item) => <option key={item.id} value={item.id}>{assignmentLabel(item)}</option>)}
          </select>
        </label>
      </div>

      {error ? <div className="call-attendance-message error" role="alert">{error}</div> : null}
      {message ? <div className="call-attendance-message" role="status">{message}</div> : null}

      {!loadingAssignments && !error && assignments.length === 0 ? (
        <div className="call-attendance-empty"><strong>Nenhuma chamada vinculada ao seu perfil.</strong><span>Solicite à administração o vínculo da turma e do horário em Módulo 3 → Presenças.</span></div>
      ) : null}
      {!loadingAssignments && assignments.length > 0 && dayAssignments.length === 0 ? (
        <div className="call-attendance-empty"><strong>Sem chamada atribuída nesta data.</strong><span>As demais abas do Ponto continuam disponíveis normalmente.</span></div>
      ) : null}
      {selectedAssignment && !loadingCall ? (
        <div className="call-attendance-summary">
          <span>{selectedAssignment.kind === 'GENERAL' ? 'Chamada geral' : selectedAssignment.activity}</span>
          <strong>{selectedAssignment.turmaName || 'Turma cadastrada'}</strong>
          <small>{CALL_PROGRAMS.find((item) => item.value === selectedAssignment.program)?.label} · {selectedAssignment.shift === 'MANHA' ? 'Manhã' : 'Tarde'} · {selectedAssignment.slot}º horário</small>
        </div>
      ) : null}
      {missingBirthDate > 0 && selectedAssignment ? <div className="call-attendance-message warning">{missingBirthDate} beneficiário(s) sem data de nascimento foram omitidos da faixa etária do programa.</div> : null}
      {selectedAssignment && !writeAllowed ? <div className="call-attendance-message warning">Prévia somente leitura. A gravação só será habilitada com uma fonte de Preview isolada.</div> : null}
      {selectedAssignment ? (
        <>
          <div className="call-attendance-progress">
            <div><strong>{counts.pendente ? `${counts.pendente} sem marcação` : 'Chamada completa'}</strong><span>{counts.presente} presentes · {counts.falta + counts.nao_compareceu} ausentes · {counts.justificado} justificados</span></div>
            <button type="button" onClick={() => void loadCall(assignmentId, date)} disabled={loadingCall}>{loadingCall ? 'Atualizando…' : 'Atualizar'}</button>
          </div>
          {loadingCall ? <div className="call-attendance-empty">Carregando a lista real da turma…</div> : participants.length === 0 ? (
            <div className="call-attendance-empty">Nenhum beneficiário ativo dessa faixa etária está matriculado nesta turma.</div>
          ) : (
            <>
              <input className="call-attendance-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou código" aria-label="Buscar beneficiário na chamada" />
              <div className="call-attendance-roster">
                {visible.map((item) => (
                  <article className="call-attendance-row" key={item.id}>
                    <div className="call-attendance-person"><strong>{item.nome}</strong><small>Código {item.codigo || '—'}</small></div>
                    <div className="call-attendance-options">
                      {statusOptions.map((option) => (
                        <button
                          type="button"
                          key={option.key}
                          className={`call-attendance-option ${marks[item.id] === option.key ? `selected ${option.key}` : ''}`}
                          title={option.label}
                          aria-label={`${option.label}: ${item.nome}`}
                          aria-pressed={marks[item.id] === option.key}
                          disabled={Boolean(savingId) || !writeAllowed}
                          onClick={() => void mark(item, option.key)}
                        >
                          <b>{option.short}</b><span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                    {savingId === item.id ? <small className="call-attendance-saving">Salvando…</small> : null}
                  </article>
                ))}
                {visible.length === 0 ? <div className="call-attendance-empty">Nenhum nome corresponde à busca.</div> : null}
              </div>
            </>
          )}
        </>
      ) : null}
      {selectedAssignment && participants.length > 0 && counts.pendente === 0 ? <div className="call-attendance-complete">Todas as pessoas da lista têm uma situação registrada nesta chamada.</div> : null}
    </section>
  );

  if (!fullPage) return panel;
  return (
    <main className="module3-shell presence-pwa-shell">
      <header className="module3-header">
        <div><span className="eyebrow">MÓDULO 3 · PWA DO PROFISSIONAL</span><h1>Presenças</h1><p>Registro individual por perfil, turma e horário.</p></div>
        <div className="module3-actions"><a className="ghost-btn" href="/app">Voltar ao Ponto</a><a className="ghost-btn" href="/modulo-3">Beneficiários</a></div>
      </header>
      {panel}
    </main>
  );
}
