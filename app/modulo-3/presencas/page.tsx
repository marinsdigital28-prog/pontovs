'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CALL_ACTIVITIES,
  CALL_PROGRAMS,
  CALL_STATUSES,
  type AttendanceMarkStatus,
  type CallAssignment,
  type CallDay,
  type CallKind,
  type CallProgram,
  type CallShift,
} from '@/lib/call-assignments';

type EmployeeOption = {
  id: string;
  name: string;
  employeeNumber: string | null;
  jobTitle: string | null;
  assignments: CallAssignment[];
};
type TurmaOption = {
  id: string;
  nome: string;
  oficina_id?: string | null;
  dias_semana?: string[] | null;
  horario_inicio?: string | null;
  horario_fim?: string | null;
};
type AttendancePerson = { id: string; nome: string; codigo: string | null; status: AttendanceMarkStatus | null };
type HistoryRecord = {
  id: string;
  date: string;
  program: CallProgram | null;
  kind: CallKind;
  activity: string | null;
  turmaId: string;
  turma: string;
  shift: string;
  slot: number | null;
  startTime: string | null;
  endTime: string | null;
  professionalId: string | null;
  professionalName: string;
  marks: Record<string, unknown>;
  participants: AttendancePerson[];
  legacy: boolean;
};
type Draft = {
  kind: CallKind | '';
  program: CallProgram | '';
  turmaId: string;
  activity: string;
  shift: CallShift | '';
  slot: '' | 1 | 2;
  days: CallDay[];
  startTime: string;
  endTime: string;
};

const emptyDraft: Draft = { kind: '', program: '', turmaId: '', activity: '', shift: '', slot: '', days: [], startTime: '', endTime: '' };
const weekdays: Array<{ key: CallDay; label: string }> = [
  { key: 'SEG', label: 'Seg' }, { key: 'TER', label: 'Ter' }, { key: 'QUA', label: 'Qua' },
  { key: 'QUI', label: 'Qui' }, { key: 'SEX', label: 'Sex' }, { key: 'SAB', label: 'Sáb' }, { key: 'DOM', label: 'Dom' },
];

function thisMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { mes: values.month, ano: values.year };
}
function assignmentSummary(item: CallAssignment) {
  const program = CALL_PROGRAMS.find((option) => option.value === item.program)?.label || item.program;
  const type = item.kind === 'GENERAL' ? 'Chamada geral' : item.activity || 'Atividade';
  const dayText = weekdays.filter((day) => item.days.includes(day.key)).map((day) => day.label).join(', ');
  const time = item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : '';
  return `${type} · ${program} · ${item.turmaName || 'Turma cadastrada'} · ${item.shift === 'MANHA' ? 'Manhã' : 'Tarde'} · ${item.slot}º horário · ${dayText}${time}`;
}
function statusLabel(status: AttendanceMarkStatus | null) {
  if (!status) return 'Sem marcação';
  return CALL_STATUSES.includes(status) ? ({ presente: 'Presente', falta: 'Falta', justificado: 'Justificado', nao_compareceu: 'Não compareceu' } as const)[status] : 'Sem marcação';
}

export default function PresencasAdminPage() {
  const current = thisMonth();
  const [view, setView] = useState<'vinculos' | 'historico'>('vinculos');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [turmas, setTurmas] = useState<TurmaOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const [sourceMessage, setSourceMessage] = useState('');
  const [writeAllowed, setWriteAllowed] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [month, setMonth] = useState(current.mes);
  const [year, setYear] = useState(current.ano);
  const [historySearch, setHistorySearch] = useState('');
  const [programFilter, setProgramFilter] = useState('TODOS');

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) || null;
  const filteredEmployees = useMemo(() => employees.filter((employee) => {
    const text = `${employee.name} ${employee.employeeNumber || ''} ${employee.jobTitle || ''}`.toLocaleLowerCase('pt-BR');
    return !employeeSearch || text.includes(employeeSearch.toLocaleLowerCase('pt-BR'));
  }), [employees, employeeSearch]);
  const filteredHistory = useMemo(() => history.filter((item) => {
    if (programFilter !== 'TODOS' && item.program !== programFilter) return false;
    const text = `${item.turma} ${item.activity || ''} ${item.professionalName} ${item.date}`.toLocaleLowerCase('pt-BR');
    return !historySearch || text.includes(historySearch.toLocaleLowerCase('pt-BR'));
  }), [history, historySearch, programFilter]);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError('');
    try {
      const response = await fetch('/api/admin/modulo-3/chamada/assignments', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os vínculos.');
      const list: EmployeeOption[] = Array.isArray(data.employees) ? data.employees : [];
      setEmployees(list);
      setTurmas(Array.isArray(data.turmas) ? data.turmas : []);
      setSourceAvailable(Boolean(data.sourceAvailable));
      setSourceMessage(String(data.sourceMessage || ''));
      setWriteAllowed(Boolean(data.writeAllowed));
      setSelectedEmployeeId((selected) => list.some((employee) => employee.id === selected) ? selected : list[0]?.id || '');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Não foi possível carregar os vínculos.');
      setEmployees([]);
      setTurmas([]);
      setSourceAvailable(false);
      setWriteAllowed(false);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const params = new URLSearchParams({ mes: month, ano: year, limit: '500' });
      const response = await fetch(`/api/modulo-3/presencas?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o histórico.');
      setHistory(Array.isArray(data.records) ? data.records : []);
    } catch (error) {
      setHistory([]);
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setHistoryLoading(false);
    }
  }, [month, year]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { if (view === 'historico') void loadHistory(); }, [view, loadHistory]);

  function updateAssignment(id: string, update: Partial<CallAssignment>) {
    setEmployees((currentEmployees) => currentEmployees.map((employee) => employee.id !== selectedEmployeeId ? employee : {
      ...employee,
      assignments: employee.assignments.map((assignment) => assignment.id === id ? { ...assignment, ...update } : assignment),
    }));
  }

  function addDraft() {
    if (!selectedEmployee || !sourceAvailable || !writeAllowed) return;
    if (draft.kind === 'WORKSHOP') {
      setSettingsError('O catálogo real de atividades ainda não pode ser confirmado. Não vou criar nem atribuir uma oficina sem verificar a fonte cadastrada.');
      return;
    }
    if (!draft.kind || !draft.program || !draft.turmaId || !draft.shift || !draft.slot || !draft.days.length) {
      setSettingsError('Preencha profissional, tipo, programa, turma, turno, horário e pelo menos um dia.');
      return;
    }
    const turma = turmas.find((item) => item.id === draft.turmaId);
    if (!turma) { setSettingsError('A turma precisa existir na fonte cadastrada.'); return; }
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const assignment: CallAssignment = {
      id,
      kind: draft.kind,
      program: draft.program,
      turmaId: draft.turmaId,
      turmaName: turma.nome,
      activity: null,
      shift: draft.shift,
      slot: draft.slot,
      days: [...draft.days],
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      active: true,
    };
    setEmployees((currentEmployees) => currentEmployees.map((employee) => employee.id === selectedEmployeeId ? { ...employee, assignments: [...employee.assignments, assignment] } : employee));
    setDraft(emptyDraft);
    setSettingsError('');
    setSettingsMessage('Vínculo adicionado ao rascunho. Salve para aplicar.');
  }

  async function saveAssignments() {
    if (!selectedEmployee || !writeAllowed) return;
    setSaving(true);
    setSettingsError('');
    setSettingsMessage('');
    try {
      const response = await fetch('/api/admin/modulo-3/chamada/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selectedEmployee.id, assignments: selectedEmployee.assignments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar os vínculos.');
      setEmployees((currentEmployees) => currentEmployees.map((employee) => employee.id === selectedEmployee.id ? { ...employee, assignments: data.assignments || [] } : employee));
      setSettingsMessage('Vínculos salvos para este perfil.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Não foi possível salvar os vínculos.');
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: CallDay) {
    setDraft((currentDraft) => ({ ...currentDraft, days: currentDraft.days.includes(day) ? currentDraft.days.filter((item) => item !== day) : [...currentDraft.days, day] }));
  }

  return (
    <main className="module3-shell presence-management-shell">
      <header className="module3-header">
        <div><span className="eyebrow">MÓDULO 3 · CONTROLE DE TURMAS</span><h1>PRESENÇAS</h1><p>Vínculos por perfil, chamadas por horário e histórico em um só lugar.</p></div>
        <div className="module3-actions"><a className="ghost-btn" href="/modulo-3">Beneficiários</a><a className="ghost-btn" href="/app">Ponto</a></div>
      </header>

      <section className="presence-admin-intro">
        <div><strong>Sem atribuição automática</strong><span>Cada perfil recebe somente os vínculos salvos pela administração.</span></div>
        <div><strong>Programas separados</strong><span>Espaço Crescer: 10–14 anos · Espaço Jovem: 15–17 anos.</span></div>
        <div><strong>Dados restritos</strong><span>Esta área registra presença; não inclui observações clínicas ou de atendimento psicológico.</span></div>
      </section>

      <div className="presence-admin-tabs" role="tablist" aria-label="Seções de presenças">
        <button type="button" className={view === 'vinculos' ? 'active' : ''} onClick={() => setView('vinculos')}>Vínculos por perfil</button>
        <button type="button" className={view === 'historico' ? 'active' : ''} onClick={() => setView('historico')}>Histórico de presenças</button>
      </div>

      {view === 'vinculos' ? (
        <section className="card presence-admin-card">
          <div className="presence-admin-section-head"><div><span className="eyebrow">CONFIGURAÇÃO EXPLÍCITA</span><h2>Quem pode chamar cada turma</h2><p>Os cargos exibidos vêm do cadastro de colaboradores. Escolha um perfil e crie somente os vínculos necessários.</p></div><button className="ghost-btn" type="button" onClick={() => void loadSettings()} disabled={loadingSettings}>Atualizar</button></div>
          {settingsError ? <div className="status-msg" role="alert">{settingsError}</div> : null}
          {settingsMessage ? <div className="presence-admin-success" role="status">{settingsMessage}</div> : null}
          {!sourceAvailable && sourceMessage ? <div className="presence-admin-warning" role="alert">{sourceMessage} O cadastro de turma não será inventado e não será possível salvar vínculos até a fonte ficar disponível.</div> : null}
          {!writeAllowed ? <div className="presence-admin-warning" role="status">Preview somente leitura: vínculos não serão salvos até existir uma conexão de banco isolada para Preview.</div> : null}
          {loadingSettings ? <div className="module3-empty">Carregando perfis e turmas cadastradas…</div> : employees.length === 0 ? (
            <div className="module3-empty"><strong>Nenhum colaborador ativo encontrado.</strong><span>Somente perfis já cadastrados são exibidos nesta área.</span></div>
          ) : (
            <div className="presence-admin-grid">
              <aside className="presence-admin-people">
                <label className="presence-admin-label">Buscar por nome, matrícula ou cargo<input className="input" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Ex.: educador, professor…" /></label>
                <div className="presence-admin-people-list">
                  {filteredEmployees.map((employee) => (
                    <button type="button" key={employee.id} className={selectedEmployeeId === employee.id ? 'selected' : ''} onClick={() => { setSelectedEmployeeId(employee.id); setSettingsError(''); setSettingsMessage(''); }}>
                      <strong>{employee.name}</strong><span>{employee.jobTitle || 'Cargo não informado'}</span><small>Matrícula {employee.employeeNumber || '—'} · {employee.assignments.length} vínculo(s)</small>
                    </button>
                  ))}
                  {filteredEmployees.length === 0 ? <p className="small-muted">Nenhum perfil corresponde à busca.</p> : null}
                </div>
              </aside>

              {selectedEmployee ? (
                <div className="presence-admin-workspace">
                  <div className="presence-admin-selected"><div><span className="eyebrow">PERFIL SELECIONADO</span><h3>{selectedEmployee.name}</h3><p>{selectedEmployee.jobTitle || 'Cargo não informado'} · Matrícula {selectedEmployee.employeeNumber || '—'}</p></div><span className="presence-admin-count">{selectedEmployee.assignments.length} vínculo(s)</span></div>
                  <div className="presence-assignment-list">
                    {selectedEmployee.assignments.map((assignment) => (
                      <article className="presence-assignment-card" key={assignment.id}>
                        <div><span className="presence-assignment-kind">{assignment.kind === 'GENERAL' ? 'CHAMADA GERAL' : 'OFICINA / ATIVIDADE'}</span><strong>{assignmentSummary(assignment)}</strong></div>
                        <div className="presence-assignment-actions"><label><input type="checkbox" checked={assignment.active} onChange={(event) => updateAssignment(assignment.id, { active: event.target.checked })} /> Ativo</label><button type="button" onClick={() => setEmployees((currentEmployees) => currentEmployees.map((employee) => employee.id === selectedEmployeeId ? { ...employee, assignments: employee.assignments.filter((item) => item.id !== assignment.id) } : employee))}>Remover</button></div>
                      </article>
                    ))}
                    {selectedEmployee.assignments.length === 0 ? <div className="module3-empty">Nenhum vínculo salvo para este perfil.</div> : null}
                  </div>

                  <div className="presence-admin-form-wrap">
                    <div><span className="eyebrow">NOVO VÍNCULO</span><h3>Adicionar turma ao perfil</h3><p>A seleção abaixo não cria atividade ou turma; usa apenas opções já cadastradas.</p></div>
                    <div className="presence-admin-form">
                      <label>Tipo de chamada<select className="input" value={draft.kind} onChange={(event) => setDraft((item) => ({ ...item, kind: event.target.value as Draft['kind'], activity: '' }))}><option value="">Selecione</option><option value="GENERAL">Chamada geral</option><option value="WORKSHOP">Oficina / atividade existente</option></select></label>
                      <label>Programa<select className="input" value={draft.program} onChange={(event) => setDraft((item) => ({ ...item, program: event.target.value as Draft['program'] }))}><option value="">Selecione</option>{CALL_PROGRAMS.map((program) => <option key={program.value} value={program.value}>{program.label} · {program.minAge}–{program.maxAge} anos</option>)}</select></label>
                      <label className="presence-admin-wide">Turma cadastrada<select className="input" value={draft.turmaId} onChange={(event) => setDraft((item) => ({ ...item, turmaId: event.target.value }))}><option value="">Selecione uma turma existente</option>{turmas.map((turma) => <option key={turma.id} value={turma.id}>{turma.nome}{turma.dias_semana?.length ? ` · ${turma.dias_semana.join(', ')}` : ''}</option>)}</select></label>
                      {draft.kind === 'WORKSHOP' ? <div className="presence-admin-warning presence-admin-wide"><strong>Atividades previstas — aguardando conferência do catálogo real:</strong><br />{CALL_ACTIVITIES.join(' · ')}<br />A lista acima não é uma confirmação de cadastro. Para evitar inventar vínculo, a atribuição de oficina fica bloqueada até a fonte mostrar quais atividades existem em cada turma.</div> : null}
                      <label>Turno<select className="input" value={draft.shift} onChange={(event) => setDraft((item) => ({ ...item, shift: event.target.value as Draft['shift'] }))}><option value="">Selecione</option><option value="MANHA">Manhã</option><option value="TARDE">Tarde</option></select></label>
                      <label>Horário<select className="input" value={draft.slot} onChange={(event) => setDraft((item) => ({ ...item, slot: event.target.value ? Number(event.target.value) as 1 | 2 : '' }))}><option value="">Selecione</option><option value="1">1º horário</option><option value="2">2º horário</option></select></label>
                      <label>Início (opcional)<input className="input" type="time" value={draft.startTime} onChange={(event) => setDraft((item) => ({ ...item, startTime: event.target.value }))} /></label>
                      <label>Fim (opcional)<input className="input" type="time" value={draft.endTime} onChange={(event) => setDraft((item) => ({ ...item, endTime: event.target.value }))} /></label>
                      <fieldset className="presence-admin-days presence-admin-wide"><legend>Dias da semana — escolha explicitamente</legend>{weekdays.map((day) => <label key={day.key}><input type="checkbox" checked={draft.days.includes(day.key)} onChange={() => toggleDay(day.key)} />{day.label}</label>)}</fieldset>
                      <button type="button" className="primary-btn presence-admin-wide" onClick={addDraft} disabled={!sourceAvailable || !writeAllowed || draft.kind === 'WORKSHOP'}>Adicionar vínculo ao rascunho</button>
                    </div>
                  </div>
                  <div className="presence-admin-save"><span>As alterações ficam no rascunho até serem salvas. Atribuições não são feitas automaticamente.</span><button type="button" className="primary-btn" onClick={() => void saveAssignments()} disabled={saving || !sourceAvailable || !writeAllowed}>{saving ? 'Salvando…' : 'Salvar vínculos deste perfil'}</button></div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <section className="card presence-admin-card">
          <div className="presence-admin-section-head"><div><span className="eyebrow">REGISTROS DA FONTE REAL</span><h2>Histórico de presenças</h2><p>Consulta de chamadas do Módulo 3, separadas por programa, turma, atividade, horário e profissional.</p></div><button className="ghost-btn" type="button" onClick={() => void loadHistory()} disabled={historyLoading}>Atualizar</button></div>
          <div className="presence-history-filters">
            <label>Mês<select className="input" value={month} onChange={(event) => setMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Ano<input className="input" type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></label>
            <label>Programa<select className="input" value={programFilter} onChange={(event) => setProgramFilter(event.target.value)}><option value="TODOS">Todos</option>{CALL_PROGRAMS.map((program) => <option key={program.value} value={program.value}>{program.label}</option>)}</select></label>
            <label>Buscar turma, atividade ou profissional<input className="input" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Digite para filtrar" /></label>
          </div>
          {historyError ? <div className="status-msg" role="alert">{historyError}</div> : null}
          {historyLoading ? <div className="module3-empty">Carregando histórico…</div> : filteredHistory.length === 0 ? <div className="module3-empty"><strong>Nenhuma chamada encontrada neste período.</strong><span>O histórico só mostra registros existentes; não há dados de demonstração.</span></div> : (
            <div className="presence-history-list">
              {filteredHistory.map((record) => {
                const present = record.participants.filter((item) => item.status === 'presente').length;
                const absent = record.participants.filter((item) => item.status === 'falta' || item.status === 'nao_compareceu').length;
                const justified = record.participants.filter((item) => item.status === 'justificado').length;
                const pending = record.participants.filter((item) => !item.status).length;
                const program = CALL_PROGRAMS.find((item) => item.value === record.program)?.label || (record.legacy ? 'Registro anterior' : record.program);
                return (
                  <article className="presence-history-card" key={record.id}>
                    <div className="presence-history-top"><div><span className="presence-assignment-kind">{record.legacy ? 'LISTA LEGADA' : record.kind === 'GENERAL' ? 'CHAMADA GERAL' : 'OFICINA / ATIVIDADE'}</span><h3>{record.activity || (record.kind === 'GENERAL' ? 'Chamada geral' : 'Atividade')}</h3><p>{program} · {record.turma} · {record.shift === 'MANHA' ? 'Manhã' : record.shift === 'TARDE' ? 'Tarde' : 'Turno não informado'}{record.slot ? ` · ${record.slot}º horário` : ''}{record.startTime && record.endTime ? ` · ${record.startTime}–${record.endTime}` : ''}</p></div><strong>{record.date}</strong></div>
                    <div className="presence-history-meta"><span>Profissional: <b>{record.professionalName || 'Não informado'}</b></span><span>{record.legacy ? 'Detalhamento anterior não vinculado a atividade' : `${present} presentes · ${absent} ausentes · ${justified} justificados · ${pending} sem marcação`}</span></div>
                    {!record.legacy ? <details className="presence-history-details"><summary>Ver lista de beneficiários ({record.participants.length})</summary><ul>{record.participants.map((participant) => <li key={participant.id}><span><strong>{participant.nome}</strong><small>Código {participant.codigo || '—'}</small></span><b className={`presence-history-status ${participant.status || 'pending'}`}>{statusLabel(participant.status)}</b></li>)}</ul></details> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
