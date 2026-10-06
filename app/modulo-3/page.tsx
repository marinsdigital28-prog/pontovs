'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Beneficiario } from '@/lib/beneficiarios-source';

const PAGE_SIZE = 60;
const emptyCounts = { todos: 0, ativos: 0, inativos: 0 };

function age(value: string | null) {
  if (!value) return '—';
  const birth = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return '—';
  const now = new Date();
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const month = now.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < birth.getUTCDate())) years -= 1;
  return `${years} anos`;
}

function contact(item: Beneficiario) {
  return item.whatsapp || item.celular || '—';
}

export default function Modulo3Page() {
  const [items, setItems] = useState<Beneficiario[]>([]);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [status, setStatus] = useState<'todos' | 'ativos' | 'inativos'>('ativos');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Beneficiario | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ status, search: submittedSearch, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const response = await fetch(`/api/modulo-3/beneficiarios?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar o cadastro.');
      setItems(Array.isArray(data.beneficiaries) ? data.beneficiaries : []);
    } catch (error) {
      setItems([]);
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar o cadastro.');
    } finally {
      setLoading(false);
    }
  }, [page, status, submittedSearch]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => items, [items]);
  const first = page * PAGE_SIZE + 1;
  const counts = emptyCounts;

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(0);
    setSubmittedSearch(search.trim());
  }

  function changeStatus(next: 'todos' | 'ativos' | 'inativos') {
    setStatus(next);
    setPage(0);
  }

  return (
    <main className="module3-shell">
      <header className="module3-header">
        <div>
          <span className="eyebrow">MÓDULO 3 · BENEFICIÁRIOS</span>
          <h1>Cadastro para a chamada</h1>
          <p>Beneficiários sincronizados diretamente com o Espaço Progredir.</p>
        </div>
        <div className="module3-actions">
          <a className="primary-btn" href="/modulo-3/presenca">Abrir chamada</a>
          <a className="ghost-btn" href="/ponto">Ponto</a>
          <a className="ghost-btn" href="/admin">Administração</a>
        </div>
      </header>

      <section className="module3-intro card">
        <div><strong>Fonte conectada</strong><span>beneficirios.marinsdigital.store</span></div>
        <div><strong>Uso nesta etapa</strong><span>Consulta para preparar a lista de presença dos professores</span></div>
        <div><strong>Registros exibidos</strong><span>{loading ? 'Carregando…' : `${shown.length} nesta página`}</span></div>
      </section>

      <section className="card module3-list-card">
        <div className="section-heading module3-heading">
          <div><span className="eyebrow">BASE DE BENEFICIÁRIOS</span><h2>Quem participará da chamada</h2><p className="small-muted">A lista é lida em tempo real; nada é copiado ou alterado nesta primeira etapa.</p></div>
          <button className="ghost-btn" type="button" onClick={() => void load()} disabled={loading}>Atualizar</button>
        </div>
        <form className="module3-search" onSubmit={submitSearch}>
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, escola, bairro ou código" aria-label="Buscar beneficiário" />
          <button className="primary-btn" type="submit">Buscar</button>
        </form>
        <div className="module3-filters" role="tablist" aria-label="Status dos beneficiários">
          {(['ativos', 'todos', 'inativos'] as const).map((key) => <button type="button" key={key} className={status === key ? 'active' : ''} onClick={() => changeStatus(key)}>{key === 'ativos' ? 'Ativos' : key === 'inativos' ? 'Inativos' : 'Todos'}{counts[key] ? ` · ${counts[key]}` : ''}</button>)}
        </div>
        {message ? <div className="status-msg" role="alert">{message}</div> : null}
        {loading ? <div className="module3-empty">Carregando beneficiários…</div> : shown.length === 0 ? <div className="module3-empty"><strong>Nenhum beneficiário encontrado.</strong><span>Tente outro termo ou altere o filtro de status.</span></div> : (
          <>
            <div className="module3-table-wrap"><table className="module3-table"><thead><tr><th>Nome</th><th>Código</th><th>Idade</th><th>Escola / bairro</th><th>Responsável</th><th>Status</th><th /></tr></thead><tbody>{shown.map((item) => <tr key={item.id}><td><strong>{item.nome}</strong><small>{item.genero || 'Beneficiário'}</small></td><td>{item.codigo || '—'}</td><td>{age(item.data_nascimento)}</td><td><span>{item.escola || 'Escola não informada'}</span><small>{item.bairro || 'Bairro não informado'}</small></td><td><span>{item.nome_mae || item.responsavel || '—'}</span><small>{contact(item)}</small></td><td><span className={`module3-status ${item.ativo ? 'on' : 'off'}`}>{item.ativo ? 'Ativo' : 'Inativo'}</span></td><td><button type="button" className="table-action" onClick={() => setSelected(item)}>Ver ficha</button></td></tr>)}</tbody></table></div>
            <div className="module3-pagination"><span>Exibindo {first}–{first + shown.length - 1}{shown.length === PAGE_SIZE ? ' · há mais registros' : ''}</span><div><button className="ghost-btn" type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>Anterior</button><button className="ghost-btn" type="button" disabled={shown.length < PAGE_SIZE || loading} onClick={() => setPage((current) => current + 1)}>Próxima</button></div></div>
          </>
        )}
      </section>

      {selected ? <div className="module3-modal-backdrop" role="presentation" onClick={() => setSelected(null)}><aside className="module3-modal" role="dialog" aria-modal="true" aria-label={`Ficha de ${selected.nome}`} onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><span className="eyebrow">FICHA DO BENEFICIÁRIO</span><h2>{selected.nome}</h2></div><button className="ghost-btn" type="button" onClick={() => setSelected(null)}>Fechar</button></div><dl className="module3-details"><div><dt>Código</dt><dd>{selected.codigo || '—'}</dd></div><div><dt>Idade</dt><dd>{age(selected.data_nascimento)}</dd></div><div><dt>Escola</dt><dd>{selected.escola || '—'}</dd></div><div><dt>Bairro</dt><dd>{selected.bairro || '—'}</dd></div><div><dt>Responsável</dt><dd>{selected.nome_mae || selected.responsavel || '—'}</dd></div><div><dt>Contato</dt><dd>{contact(selected)}</dd></div><div><dt>Turno</dt><dd>{selected.turno || '—'}</dd></div><div><dt>Risco</dt><dd>{selected.classe_risco || '—'}</dd></div></dl><button className="primary-btn module3-full-btn" type="button" onClick={() => setSelected(null)}>Selecionar depois na lista de presença</button></aside></div> : null}
    </main>
  );
}
