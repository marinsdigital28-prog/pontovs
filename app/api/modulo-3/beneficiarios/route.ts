import { NextResponse } from 'next/server';
import { listBeneficiarios } from '@/lib/beneficiarios-source';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const safeStatus = status === 'ativos' || status === 'inativos' ? status : 'todos';
  const search = url.searchParams.get('search') || '';
  const limit = Number(url.searchParams.get('limit') || 100);
  const offset = Number(url.searchParams.get('offset') || 0);
  if (search.length > 80) return NextResponse.json({ error: 'Busca muito longa.' }, { status: 400 });
  try {
    const beneficiaries = await listBeneficiarios({ search, status: safeStatus, limit, offset });
    return NextResponse.json({ source: 'beneficirios.marinsdigital.store', beneficiaries, limit, offset });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar os beneficiários.' }, { status: 502 });
  }
}
