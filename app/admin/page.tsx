export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import AdminDashboard from './admin-dashboard';

export default async function AdminPage() {
  const session = (await getServerSession(authOptions as any)) as any;
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) redirect('/auth/signin?callbackUrl=/admin');
  const manager = await prisma.user.findFirst({ where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { name: true } });
  if (!manager) redirect('/auth/signin?callbackUrl=%2Fadmin');
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [employeeCount, punchesToday, openInconsistencies, employeeOptions] = await Promise.all([
    prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } }).catch(() => 0),
    prisma.punch.count({ where: { timestamp: { gte: start } } }).catch(() => 0),
    prisma.inconsistency.count({ where: { status: 'OPEN' } }).catch(() => 0),
    prisma.user.findMany({ where: { role: 'EMPLOYEE' }, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true }, orderBy: { name: 'asc' } }).catch(() => []),
  ]);
  return <main className="admin-container"><header className="admin-header"><div><div className="header-brand">PONTO PROGREDIR</div><h1>Central administrativa</h1><p className="small-muted">Gestão operacional · {manager.name}</p></div><a className="ghost-btn" href="/ponto">Abrir ponto</a></header><AdminDashboard employees={employeeOptions.map((item) => ({ ...item, active: item.active }))} stats={{ employeeCount, punchesToday, openInconsistencies }} /><footer className="admin-footer">Desenvolvido por Marins Digital</footer></main>;
}
