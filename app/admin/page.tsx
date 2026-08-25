import prisma from '@/lib/prisma';



export default async function AdminPage() {
  
  const manager = await prisma.user.findFirst({
    
    where: { role: { in: ['ADMIN', 'MANAGER'] } },
    
    select: { name: true, email: true, role: true },
    
  }) ?? { name: 'Gestor', email: '', role: 'ADMIN' as const };
  

  
  const today = new Date();
  
  today.setHours(0, 0, 0, 0);
  
  const [employees, punchesToday, openInconsistencies, recentPunches] = await Promise.all([
    
    prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } }),
    
    prisma.punch.count({ where: { timestamp: { gte: today } } }),
    
    prisma.inconsistency.count({ where: { status: 'OPEN' } }),
    
    prisma.punch.findMany({ orderBy: { timestamp: 'desc' }, take: 12, include: { user: { select: { name: true, employeeNumber: true } } } }),
    
  ]);
  

  
  return <main className="container" style={{ maxWidth: 1180 }}><div className="header-row"><div><div className="header-brand">Ponto Progredir</div>div><div className="header-greeting">Painel do gestor</div>div></div>div><div className="small-muted">{manager.name}</div>div></div>div>
  
    <section className="card" style={{ marginBottom: 18 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><div><h1 style={{ margin: 0 }}>Visão geral</h1>h1><p className="small-muted">Os dados abaixo vêm do mesmo banco usado pelo /ponto.</p>p></div>div><a className="btn-secondary" href="/ponto">Abrir ponto</a>a></div>div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 }}><div className="summary"><div className="small-muted">Colaboradores ativos</div>div><strong style={{ fontSize: 28 }}>{employees}</strong>strong></div>div><div className="summary"><div className="small-muted">Marcações hoje</div>div><strong style={{ fontSize: 28 }}>{punchesToday}</strong>strong></div>div><div className="summary"><div className="small-muted">Inconsistências abertas</div>div><strong style={{ fontSize: 28 }}>{openInconsistencies}</strong>strong></div>div></div>div></section>section>
  
    <section className="card"><h2>Últimas marcações</h2>h2><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={{ textAlign: 'left', padding: 10 }}>Colaborador</th>th><th style={{ textAlign: 'left', padding: 10 }}>Matrícula</th>th><th style={{ textAlign: 'left', padding: 10 }}>Tipo</th>th><th style={{ textAlign: 'left', padding: 10 }}>Data e hora</th>th><th style={{ textAlign: 'left', padding: 10 }}>Status</th>th></tr>tr></thead>thead><tbody>{recentPunches.map((punch) => <tr key={punch.id} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 10 }}>{punch.user.name}</td>td><td style={{ padding: 10 }}>{punch.user.employeeNumber || '—'}</td>td><td style={{ padding: 10 }}>{punch.type}</td>td><td style={{ padding: 10 }}>{new Date(punch.timestamp).toLocaleString('pt-BR')}</td>td><td style={{ padding: 10 }}>{punch.status}</td>td></tr>tr>)}</tbody>tbody></table>table></div>div></section>section></main>main>;
  
}

</div>














