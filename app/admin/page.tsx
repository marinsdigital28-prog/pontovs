import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export default async function AdminPage() {
  const session = await getServerSession(authOptions as any);
  if (!session?.user?.email) redirect('/auth/signin');

  const manager = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { name: true, email: true, role: true },
  });
  if (!manager || !['ADMIN', 'MANAGER'].includes(manager.role)) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <section className="card" style={{ maxWidth: 520, width: '100%' }}>
          <h1>Acesso restrito</h1>
          <p className="small-muted">Esta área é exclusiva para gestores e administradores.</p>
          <a className="btn-secondary" href="/ponto">Voltar ao ponto</a>
        </section>
      </main>
    );
  }

  const [employees, punchesToday, openInconsistencies, recentPunches] = await Promise.all([
    prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } }),
    prisma.punch.count({ where: { timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.inconsistency.count({ where: { status: 'OPEN' } }),
    prisma.punch.findMany({
      orderBy: { timestamp: 'desc' },
      take: 12,
      include: { user: { select: { name: true, employeeNumber: true } } },
    }),
  ]);

  return (
    <main className="container" style={{ maxWidth: 1180 }}>
      <div className="header-row">
        <div>
          <div className="header-brand">Ponto Progredir</div>
          <div className="header-greeting">Painel do gestor</div>
        </div>
        <div className="small-muted">{manager.name}</div>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div><h1 style={{ margin: 0 }}>Visão geral</h1><p className="small-muted">Os dados abaixo vêm do mesmo banco usado pelo /ponto.</p></div>
          <a className="btn-secondary" href="/ponto">Abrir ponto</a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 }}>
          <div className="summary"><div className="small-muted">Colaboradores ativos</div><strong style={{ fontSize: 28 }}>{employees}</strong></div>
          <div className="summary"><div className="small-muted">Marcações hoje</div><strong style={{ fontSize: 28 }}>{punchesToday}</strong></div>
          <div className="summary"><div className="small-muted">Inconsistências abertas</div><strong style={{ fontSize: 28 }}>{openInconsistencies}</strong></div>
        </div>
      </section>

      <section className="card">
        <h2>Últimas marcações</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left', padding: 10 }}>Colaborador</th><th style={{ textAlign: 'left', padding: 10 }}>Matrícula</th><th style={{ textAlign: 'left', padding: 10 }}>Tipo</th><th style={{ textAlign: 'left', padding: 10 }}>Data e hora</th><th style={{ textAlign: 'left', padding: 10 }}>Status</th></tr></thead>
            <tbody>{recentPunches.map((punch) => (
              <tr key={punch.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 10 }}>{punch.user.name}</td>
                <td style={{ padding: 10 }}>{punch.user.employeeNumber || '—'}</td>
                <td style={{ padding: 10 }}>{punch.type}</td>
                <td style={{ padding: 10 }}>{new Date(punch.timestamp).toLocaleString('pt-BR')}</td>
                <td style={{ padding: 10 }}>{punch.status}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
