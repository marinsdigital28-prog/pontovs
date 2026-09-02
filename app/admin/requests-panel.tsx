'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type RequestItem = { id: string; type: 'AUSENCIA' | 'TROCA_DIA' | 'ESQUECI_PONTO'; status: string; startDate: string; endDate: string; reason: string; details?: string | null; medicalSpecialty?: string | null; classification?: string | null; returnExpected?: boolean | null; documentName?: string | null; documentMime?: string | null; reviewNote?: string | null; createdAt: string; employee: { id: string; name: string; employeeNumber: string | null; jobTitle: string | null }; reviewer?: { name: string } | null };
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR');
const COVERAGE_LABEL: Record<string, string> = {
  PARCIAL_MANHA: 'Parcial manhã',
  PARCIAL_TARDE: 'Parcial tarde',
  DIA_INTEIRO: 'Dia inteiro',
  EMERGENCIA: 'Emergência',
  POR_HORAS: 'Por horas',
  POR_DIAS: 'Por dias',
  ENTRADA: 'Entrada',
  INTERVALO: 'Intervalo',
  RETORNO: 'Retorno',
  SAIDA: 'Saída',
};
const coverageLabel = (v?: string | null) => (v ? COVERAGE_LABEL[v] || v : null);

export default function RequestsPanel() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [filter, setFilter] = useState('TODOS');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => { const response = await fetch('/api/admin/requests', { cache: 'no-store' }); if (response.ok) setItems((await response.json()).requests || []); }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000); const onFocus = () => void load(); window.addEventListener('focus', onFocus); return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); }; }, [load]);
  const visible = useMemo(() => filter === 'TODOS' ? items : items.filter(item => item.status === filter), [filter, items]);
  async function decide(id: string, decision: 'APROVAR' | 'REJEITAR') { setLoading(true); setMessage(''); const response = await fetch('/api/admin/requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision, reviewNote: note || null }) }); const data = await response.json().catch(() => ({})); if (!response.ok) setMessage(data.error || 'Não foi possível registrar a decisão.'); else { setMessage(decision === 'APROVAR' ? 'Solicitação aprovada.' : 'Solicitação rejeitada.'); setNote(''); await load(); } setLoading(false); }
  return <section className="card"><div className="section-heading"><div><span className="eyebrow">COLABORADORES</span><h2>Solicitações</h2><p className="small-muted">Ausências, esqueci de marcar e trocas de dia enviadas pelo app do colaborador.</p></div></div><div className="presence-filters">{['TODOS', 'PENDENTE', 'APROVADO', 'REJEITADO'].map(value => <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value} <b>{value === 'TODOS' ? items.length : items.filter(item => item.status === value).length}</b></button>)}</div>{message ? <div className="status-msg">{message}</div> : null}<div className="request-list">{visible.map(item => <article className="request-card" key={item.id}><div className="request-card-main"><div><span className="eyebrow">{item.type === 'AUSENCIA' ? (item.classification === 'EMERGENCIA' ? 'AUSÊNCIA · EMERGÊNCIA' : 'AUSÊNCIA') : item.type === 'ESQUECI_PONTO' ? 'ESQUECI DE MARCAR' : 'TROCA DE DIA'}</span><h3>{item.employee.name}</h3><p>{item.employee.employeeNumber || 'Sem matrícula'} · {item.employee.jobTitle || 'Cargo não informado'}</p></div><span className={`status-pill ${item.status === 'APROVADO' ? 'ok' : item.status === 'REJEITADO' ? 'off' : ''}`}>{item.status}</span></div><div className="request-meta"><span><b>Período</b> {date(item.startDate)}{item.endDate !== item.startDate ? ` até ${date(item.endDate)}` : ''}</span><span><b>Motivo</b> {item.reason}</span>{item.classification ? <span><b>Tipo</b> {coverageLabel(item.classification)}</span> : null}{item.medicalSpecialty ? <span><b>Especialidade</b> {item.medicalSpecialty}</span> : null}<span><b>Retorno</b> {item.returnExpected === null || item.returnExpected === undefined ? 'Não informado' : item.returnExpected ? 'Sim' : 'Não'}</span>{item.documentName ? <span><b>Documento</b> <a className="request-document-link" href={`/api/admin/requests/${item.id}/document`} target="_blank" rel="noreferrer">{item.documentName}</a> ({item.documentMime || 'arquivo'})</span> : null}{item.details ? <span><b>Detalhes</b> {item.details}</span> : null}</div>{item.status === 'PENDENTE' ? <div className="request-decision"><input value={note} onChange={event => setNote(event.target.value)} placeholder="Observação opcional da decisão" maxLength={1000} /><button className="primary-btn" type="button" disabled={loading} onClick={() => void decide(item.id, 'APROVAR')}>Aprovar</button><button className="danger-btn" type="button" disabled={loading} onClick={() => void decide(item.id, 'REJEITAR')}>Rejeitar</button></div> : item.reviewNote ? <p className="small-muted">Decisão: {item.reviewNote}</p> : null}</article>)}{!visible.length ? <div className="report-empty"><strong>Nenhuma solicitação neste filtro.</strong><span>As novas solicitações dos colaboradores aparecerão aqui.</span></div> : null}</div></section>;
}
