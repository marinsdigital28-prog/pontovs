const demoEvents = [
  { action: 'EMPLOYEE_UPDATED', detail: 'Jornada de Maicon Fernandes Marins revisada', time: 'Hoje, 08:42', hash: 'a84c91f2d4c0e8ab' },
  { action: 'PUNCHES_EXPORTED', detail: 'Relatório mensal exportado pelo gestor', time: 'Hoje, 08:20', hash: '39f0b7c1aa2d944e' },
  { action: 'AUDIT_VIEWED', detail: 'Cadeia de auditoria consultada', time: 'Hoje, 08:11', hash: '9bd1c2e8794af011' },
];

export default function PreviewPage() {
  return (
    <main className="preview-shell">
      <header className="preview-header">
        <div><span className="eyebrow">PREVIEW LOCAL · SEM PERSISTÊNCIA</span><h1>Ponto Progredir</h1><p>Visão demonstrativa das interfaces protegidas antes do próximo deployment.</p></div>
        <div className="preview-links"><a className="ghost-btn" href="/admin">Abrir admin real</a><a className="primary-btn" href="/colaborador">Abrir área do funcionário</a></div>
      </header>
      <section className="preview-grid">
        <article className="preview-card preview-admin-card">
          <div className="preview-card-heading"><div><span className="eyebrow">GESTÃO</span><h2>Painel administrativo</h2><p>Controle de equipe, jornada, registros e segurança.</p></div><span className="status-pill ok">Protegido</span></div>
          <div className="preview-stat-grid"><div><span>Colaboradores ativos</span><strong>33</strong></div><div><span>Marcações hoje</span><strong>18</strong></div><div><span>Pendências abertas</span><strong>4</strong></div></div>
          <div className="preview-security"><div><span className="eyebrow">SEGURANÇA E AUDITORIA</span><strong>Cadeia íntegra</strong><p>Rate limiting ativo · 60 consultas/min · eventos encadeados por hash.</p></div><span className="security-check">✓</span></div>
          <div className="preview-event-list">{demoEvents.map(event => <div className="preview-event" key={event.hash}><div><strong>{event.action}</strong><span>{event.detail} · {event.time}</span></div><code>{event.hash}…</code></div>)}</div>
        </article>
        <article className="preview-card preview-employee-card">
          <div className="preview-card-heading"><div><span className="eyebrow">AUTOSSERVIÇO</span><h2>Área do funcionário</h2><p>Informações pessoais e profissionais sem acesso à batida pelo telefone.</p></div><span className="status-pill ok">Identificado</span></div>
          <div className="preview-employee-identity"><div className="avatar-letter">M</div><div><strong>Maicon Fernandes Marins</strong><span>Matrícula 4041 · Presidente</span><span>Espaço Progredir</span></div></div>
          <div className="preview-info-grid"><div><span>Jornada</span><strong>SEG–SEX · 08:00–17:00</strong></div><div><span>Período</span><strong>18 dias trabalhados</strong></div><div><span>Saldo mensal</span><strong>+02:15</strong></div><div><span>Solicitações</span><strong>1 em análise</strong></div></div>
          <div className="preview-actions"><button className="primary-btn" type="button">Minhas informações</button><button className="ghost-btn" type="button">Informar ausência</button><button className="ghost-btn" type="button">Solicitar troca de dia</button></div>
          <div className="preview-notice"><strong>Registro pelo telefone bloqueado</strong><span>A batida continua disponível somente no relógio autorizado.</span></div>
        </article>
      </section>
    </main>
  );
}
