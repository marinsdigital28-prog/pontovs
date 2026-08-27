import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../../../lib/auth';
import prisma from '../../../../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions as any) as any;
  const role = String(session?.user?.role || '');
  if (!session?.user?.id || !['ADMIN', 'MANAGER'].includes(role)) return NextResponse.json({ error: 'Acesso administrativo necessário.' }, { status: 401 });
  const request = await prisma.employeeRequest.findUnique({ where: { id }, select: { documentData: true, documentMime: true, documentName: true } });
  if (!request?.documentData) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
  const match = request.documentData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return NextResponse.json({ error: 'Documento inválido.' }, { status: 422 });
  return new NextResponse(Buffer.from(match[2], 'base64'), { status: 200, headers: { 'Content-Type': request.documentMime || match[1], 'Content-Disposition': `inline; filename="${(request.documentName || 'documento').replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Cache-Control': 'private, no-store' } });
}
