export const dynamic = 'force-dynamic';

import React from 'react';
import prisma from '@/lib/prisma';


const h = React.createElement;


export default async function AdminPage() {
  const employees = await prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } });
  return h('main', { className: 'container', style: { maxWidth: 1180 } },
    h('div', { className: 'header-row' },
      h('div', null, h('div', { className: 'header-brand' }, 'Ponto Progredir'), h('div', { className: 'header-greeting' }, 'Painel do gestor')),
      h('a', { className: 'btn-secondary', href: '/ponto' }, 'Abrir ponto')
    ),
    h('section', { className: 'card' },
      h('h1', null, 'Painel administrativo'),
      h('p', { className: 'small-muted' }, 'Acesso liberado sem senha, conforme solicitado.'),
      h('p', null, 'Colaboradores ativos: ', h('strong', null, employees))
    )
  );
}

