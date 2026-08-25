export const dynamic = 'force-dynamic';






import React from 'react';


import { redirect } from 'next/navigation';


import { getServerSession } from 'next-auth/next';


import { authOptions } from '@/lib/auth';


import prisma from '@/lib/prisma';






const h = React.createElement;






export default async function AdminPage() {
  
  const session = (await getServerSession(authOptions as any)) as any;
  
  const sessionUserId = session?.user?.id;
  
  if (!sessionUserId) redirect('/auth/signin?callbackUrl=/admin');
  


  
  const manager = await prisma.user.findFirst({
    
    where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    
    select: { name: true, email: true, role: true },
    
  });
  
  if (!manager) redirect('/ponto');
  


  
  const [employees, punchesToday, openInconsistencies] = await Promise.all([
    
    prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } }),
    
    prisma.punch.count({ where: { timestamp: { gte: startOfToday() } } }),
    
    prisma.inconsistency.count({ where: { status: 'OPEN' } }),
    
  ]);
  


  
  return h('main', { className: 'container', style: { maxWidth: 1180 } },
           
    h('div', { className: 'header-row' },
      
      h('div', null,
        
        h('div', { className: 'header-brand' }, 'Ponto Progredir'),
        
        h('div', { className: 'header-greeting' }, 'Painel do gestor')
        
      ),
      
      h('div', { className: 'small-muted' }, manager.name)
      
    ),
           
    h('section', { className: 'card' },
      
      h('h1', null, 'Painel administrativo'),
      
      h('p', { className: 'small-muted' }, 'Área restrita a gestores autenticados.'),
      
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 } },
        
        summary('Colaboradores ativos', employees),
        
        summary('Marcações hoje', punchesToday),
        
        summary('Inconsistências abertas', openInconsistencies)
        
      )
      
    )
           
  );
  
}






function startOfToday() {
  
  const date = new Date();
  
  date.setHours(0, 0, 0, 0);
  
  return date;
  
}






function summary(label: string, value: number) {
  
  return h('div', { className: 'summary' },
           
    h('div', { className: 'small-muted' }, label),
           
    h('strong', { style: { fontSize: 28 } }, value)
           
  );
  
}



























































































