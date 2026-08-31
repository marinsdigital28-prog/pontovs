import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { normalizeCpf } from '@/lib/employee-validation';
import { appendAuditEvent, consumeRateLimit, getRequestKey, rateLimitResponse } from '@/lib/security-controls';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

async function requireManager() {
  const session = (await getServerSession(authOptions as any)) as any;
  const id = session?.user?.id as string | undefined;
  if (!id) return null;
  return prisma.user.findFirst({
    where: { id, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true, name: true },
  });
}

async function loadBuiltinItems() {
  const filePath = path.join(process.cwd(), 'imports', 'employees-enrich-only.json');
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function POST(request: Request) {
  const manager = await requireManager();
  if (!manager) return NextResponse.json({ error: 'Acesso restrito ao gestor' }, { status: 401 });

  const rate = await consumeRateLimit(getRequestKey(request, 'admin-enrich-employees', manager.id), 5, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null);
  let items: any[] | null = Array.isArray(body?.items) ? body.items : null;
  if ((!items || !items.length) && body?.fromBuiltin) {
    try {
      items = await loadBuiltinItems();
    } catch {
      return NextResponse.json({ error: 'Arquivo de enriquecimento não encontrado no deploy.' }, { status: 500 });
    }
  }
  if (!items?.length) return NextResponse.json({ error: 'Lista de enriquecimento vazia.' }, { status: 400 });

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    const employeeNumber = String(item?.employeeNumber ?? '').replace(/\D/g, '').trim();
    if (!employeeNumber) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.user.findFirst({
      where: { employeeNumber, role: 'EMPLOYEE' },
      select: { id: true, cpf: true, profileJson: true },
    });
    if (!existing) {
      skipped += 1;
      errors.push(`Matrícula ${employeeNumber} não encontrada`);
      continue;
    }

    const data: Record<string, unknown> = {};
    if (item.cpf) {
      const cpf = normalizeCpf(String(item.cpf));
      if (cpf) data.cpf = cpf;
    }
    if (item.profile && typeof item.profile === 'object') {
      let prev: Record<string, unknown> = {};
      try {
        prev = existing.profileJson ? JSON.parse(existing.profileJson) : {};
      } catch {
        prev = {};
      }
      data.profileJson = JSON.stringify({ ...prev, ...item.profile });
    }

    if (!Object.keys(data).length) {
      skipped += 1;
      continue;
    }

    try {
      await prisma.user.update({ where: { id: existing.id }, data });
      updated += 1;
    } catch (err: any) {
      skipped += 1;
      errors.push(`Falha em ${employeeNumber}: ${err?.code || err?.message || 'erro'}`);
    }
  }

  await appendAuditEvent({
    action: 'EMPLOYEES_ENRICHED',
    actorId: manager.id,
    resource: 'User',
    metadata: { updated, skipped },
  });

  return NextResponse.json({ ok: true, updated, skipped, errors: errors.slice(0, 20) });
}
