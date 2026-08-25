import React from 'react';

import prisma from '@/lib/prisma';



const h = React.createElement;



export default async function AdminPage() {
  
  const manager = await prisma.user.findFirst({
    
    where: { role: { in: ['ADMIN', 'MANAGER'] } },
    
    select: { name: true, email: true, role: true },
    
  });
  
  const today = new Date();
  
  today.setHours(0, 0, 0, 0);
  
  const [employees, punchesToday, openInconsistencies, recentPunches] = await Promise.all([
    
    prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } }),
    
    prisma.punch.count({ where: { timestamp: { gte: today } } }),
    
    prisma.inconsistency.count({ where: { status: 'OPEN' } }),
    
    prisma.punch.findMany({ orderBy: { timestamp: 'desc' }, take: 12, include: { user: { select: { name: true, employeeNumber: true } } } }),
    
  ]);
  
  const summary = (label: string, value: number) => h('div', { className: 'summary' }, h('div', { className: 'small-muted' }, label), h('strong', { style: { fontSize: 28 } }, value));
  
  const rows = recentPunches.map((punch) => h('tr', { key: punch.id, style: { borderTop: '1px solid var(--border)' } },
                                              
    h('td', { style: { padding: 10 } }, punch.user.name),
                                              
    h('td', { style: { padding: 10 } }, punch.user.employeeNumber || '—'),
                                              
    h('td', { style: { padding: 10 } }, punch.type),
                                              
    h('td', { style: { padding: 10 } }, new Date(punch.timestamp).toLocaleString('pt-BR')),
                                              
    h('td', { style: { padding: 10 } }, punch.status)
                                              
  ));
  
  const header = h('div', { className: 'header-row' },
                   
    h('div', null, h('div', { className: 'header-brand' }, 'Ponto Progredir'), h('div', { className: 'header-greeting' }, 'Painel do gestor')),
                   
    h('div', { className: 'small-muted' }, manager?.name || 'Gestor')
                   
  );
  
  const overview = h('section', { className: 'card', style: { marginBottom: 18 } },
                     
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
      
      h('div', null, h('h1', { style: { margin: 0 } }, 'Visão geral'), h('p', { className: 'small-muted' }, 'Os dados abaixo vêm do mesmo banco usado pelo /ponto.')),
      
      h('a', { className: 'btn-secondary', href: '/ponto' }, 'Abrir ponto')
      
    ),
                     
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 } },
      
      summary('Colaboradores ativos', employees), summary('Marcações hoje', punchesToday), summary('Inconsistências abertas', openInconsistencies)
      
    )
                     
  );
  
  const table = h('section', { className: 'card' }, h('h2', null, 'Últimas marcações'), h('div', { style: { overflowX: 'auto' } },
                                                                                          
    h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
      
      h('thead', null, h('tr', null, ...['Colaborador', 'Matrícula', 'Tipo', 'Data e hora', 'Status'].map((label) => h('th', { key: label, style: { textAlign: 'left', padding: 10 } }, label))),
        
      h('tbody', null, ...rows)
        
    )
      
  ));
  
  return h('main', { className: 'container', style: { maxWidth: 1180 } }, header, overview, table);
  
}










































