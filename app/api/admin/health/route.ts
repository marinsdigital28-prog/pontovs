import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

/** Limite Free Neon (0,5 GB) — ajuste via env se o plano mudar */
const DEFAULT_STORAGE_LIMIT_BYTES = 512 * 1024 * 1024;

function manager(session: any) {
  return Boolean(session?.user?.id && ['ADMIN', 'MANAGER'].includes(String(session?.user?.role || 'ADMIN')));
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!manager(session)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });

  let database: 'operacional' | 'indisponivel' = 'operacional';
  let databaseLatencyMs: number | null = null;
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseLatencyMs = Date.now() - started;
  } catch {
    database = 'indisponivel';
  }

  const storageLimitBytes = Number(process.env.NEON_STORAGE_LIMIT_BYTES || DEFAULT_STORAGE_LIMIT_BYTES);
  let storage: null | {
    databaseBytes: number;
    databaseLabel: string;
    limitBytes: number;
    limitLabel: string;
    usedPercent: number;
    status: 'ok' | 'warn' | 'critical';
    freeBytes: number;
    freeLabel: string;
    tables: Array<{ name: string; bytes: number; label: string }>;
    photos: {
      count: number;
      bytes: number;
      label: string;
      avgBytes: number;
    };
    month: {
      punches: number;
      withPhoto: number;
      photoBytes: number;
      photoLabel: string;
      daysElapsed: number;
      daysInMonth: number;
      projectedPhotoBytes: number;
      projectedPhotoLabel: string;
      projectedTotalBytes: number;
      projectedTotalLabel: string;
      projectedPercent: number;
      safeUntilMonthEnd: boolean;
    };
  } = null;

  if (database === 'operacional') {
    try {
      const [dbSizeRow] = await prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT pg_database_size(current_database())::bigint AS size
      `;
      const tableRows = await prisma.$queryRaw<
        Array<{ name: string; size: bigint }>
      >`
        SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS size
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 8
      `;

      const [photoRow] = await prisma.$queryRaw<
        Array<{ count: bigint; bytes: bigint | null }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "photoData" IS NOT NULL)::bigint AS count,
          COALESCE(SUM(octet_length("photoData")), 0)::bigint AS bytes
        FROM "Punch"
      `;

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
      const nextMonth = new Date(year, month + 1, 1, 0, 0, 0, 0);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysElapsed = Math.max(1, Math.min(daysInMonth, now.getDate()));

      const [monthRow] = await prisma.$queryRaw<
        Array<{ punches: bigint; with_photo: bigint; photo_bytes: bigint | null }>
      >`
        SELECT
          COUNT(*)::bigint AS punches,
          COUNT(*) FILTER (WHERE "photoData" IS NOT NULL)::bigint AS with_photo,
          COALESCE(SUM(octet_length("photoData")), 0)::bigint AS photo_bytes
        FROM "Punch"
        WHERE "timestamp" >= ${monthStart} AND "timestamp" < ${nextMonth}
      `;

      const databaseBytes = Number(dbSizeRow?.size || 0);
      const photoCount = Number(photoRow?.count || 0);
      const photoBytes = Number(photoRow?.bytes || 0);
      const monthPunches = Number(monthRow?.punches || 0);
      const monthWithPhoto = Number(monthRow?.with_photo || 0);
      const monthPhotoBytes = Number(monthRow?.photo_bytes || 0);

      const projectedPhotoBytes = Math.round((monthPhotoBytes / daysElapsed) * daysInMonth);
      // Espaço além das fotos do mês = banco atual - fotos do mês + projeção de fotos do mês
      const projectedTotalBytes = Math.max(0, databaseBytes - monthPhotoBytes + projectedPhotoBytes);
      const usedPercent = storageLimitBytes > 0 ? Math.min(100, (databaseBytes / storageLimitBytes) * 100) : 0;
      const projectedPercent =
        storageLimitBytes > 0 ? Math.min(200, (projectedTotalBytes / storageLimitBytes) * 100) : 0;
      const freeBytes = Math.max(0, storageLimitBytes - databaseBytes);

      let status: 'ok' | 'warn' | 'critical' = 'ok';
      if (usedPercent >= 90 || projectedPercent >= 100) status = 'critical';
      else if (usedPercent >= 70 || projectedPercent >= 85) status = 'warn';

      storage = {
        databaseBytes,
        databaseLabel: formatBytes(databaseBytes),
        limitBytes: storageLimitBytes,
        limitLabel: formatBytes(storageLimitBytes),
        usedPercent: Math.round(usedPercent * 10) / 10,
        status,
        freeBytes,
        freeLabel: formatBytes(freeBytes),
        tables: tableRows.map((row) => ({
          name: row.name,
          bytes: Number(row.size),
          label: formatBytes(Number(row.size)),
        })),
        photos: {
          count: photoCount,
          bytes: photoBytes,
          label: formatBytes(photoBytes),
          avgBytes: photoCount ? Math.round(photoBytes / photoCount) : 0,
        },
        month: {
          punches: monthPunches,
          withPhoto: monthWithPhoto,
          photoBytes: monthPhotoBytes,
          photoLabel: formatBytes(monthPhotoBytes),
          daysElapsed,
          daysInMonth,
          projectedPhotoBytes,
          projectedPhotoLabel: formatBytes(projectedPhotoBytes),
          projectedTotalBytes,
          projectedTotalLabel: formatBytes(projectedTotalBytes),
          projectedPercent: Math.round(projectedPercent * 10) / 10,
          safeUntilMonthEnd: projectedPercent < 95 && usedPercent < 90,
        },
      };
    } catch (error) {
      console.error('health storage metrics failed', error);
    }
  }

  const automaticEmail = Boolean(
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN,
  );

  const payload = {
    checkedAt: new Date().toISOString(),
    api: 'operacional',
    database,
    databaseLatencyMs,
    notifications: {
      provider: 'Gmail',
      automaticDispatch: automaticEmail ? 'configurado' : 'pendente_configuracao',
    },
    storage,
    note:
      'Uso medido no PostgreSQL (Neon). Limite padrão Free = 0,5 GB. Ajuste NEON_STORAGE_LIMIT_BYTES se o plano for maior.',
  };

  return NextResponse.json(payload, {
    status: database === 'operacional' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
