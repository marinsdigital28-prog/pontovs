export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isDatabaseQuotaExceeded } from '@/lib/database-errors';
import { listEmployeeFallbacks } from '@/lib/employee-fallback';
import AdminDashboard from './admin-dashboard';

export default async function AdminPage() {
  const session = (await getServerSession(authOptions as any)) as any;
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) redirect('/auth/signin?callbackUrl=/admin');
  let degraded = false;
  let manager: { name: string } | null = null;
  try {
    manager = await prisma.user.findFirst({ where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } }, select: { name: true } });
  } catch (error) {
    if (!isDatabaseQuotaExceeded(error)) throw error;
    degraded = true;
    manager = { name: 'Gestor (modo contingência)' };
  }
  if (!manager) redirect('/auth/signin?callbackUrl=%2Fadmin');
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const safeCount = async (query: () => Promise<number>) => {
    try { return await query(); } catch (error) { if (isDatabaseQuotaExceeded(error)) degraded = true; return 0; }
  };
  const safeEmployees = async () => {
    try {
      return await prisma.user.findMany({ where: { role: 'EMPLOYEE' }, select: { id: true, name: true, employeeNumber: true, cpf: true, jobTitle: true, workDays: true, scheduleStart: true, scheduleEnd: true, scheduleByDay: true, active: true }, orderBy: { name: 'asc' } });
    } catch (error) {
      if (isDatabaseQuotaExceeded(error)) { degraded = true; return listEmployeeFallbacks(); }
      return [];
    }
  };
  const [employeeCount, punchesToday, openInconsistencies, employeeOptions] = await Promise.all([
    safeCount(() => prisma.user.count({ where: { active: true, role: 'EMPLOYEE' } })),
    safeCount(() => prisma.punch.count({ where: { timestamp: { gte: start } } })),
    safeCount(() => prisma.inconsistency.count({ where: { status: 'OPEN' } })),
    safeEmployees(),
  ]);
  const displayedEmployeeCount = degraded ? employeeOptions.length : employeeCount;
  return <main className="admin-container"><header className="admin-header"><div><div className="header-brand">PONTO PROGREDIR</div><h1>Central administrativa</h1><p className="small-muted">Gestão operacional · {manager.name}</p></div><a className="ghost-btn" href="/ponto">Abrir ponto</a></header><AdminDashboard employees={employeeOptions.map((item) => ({ ...item, active: item.active }))} stats={{ employeeCount: displayedEmployeeCount, punchesToday, openInconsistencies }} degraded={degraded} /><footer className="admin-footer">Desenvolvido por Marins Digital</footer></main>;
}
