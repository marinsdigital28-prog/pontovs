import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '../../../../../../lib/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await getServerSession(authOptions as any)) as any;
  const sessionUserId = session?.user?.id as string | undefined;
  if (!sessionUserId) return new NextResponse('Não autenticado', { status: 401 });

  const manager = await prisma.user.findFirst({
    where: { id: sessionUserId, active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true },
  });
  if (!manager) return new NextResponse('Acesso restrito ao gestor', { status: 403 });

  const punch = await prisma.punch.findUnique({ where: { id }, select: { photoData: true } });
  if (!punch?.photoData) return new NextResponse('Foto não encontrada', { status: 404 });

  const match = punch.photoData.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!match) return new NextResponse('Formato de foto inválido', { status: 415 });
  return new NextResponse(Buffer.from(match[2], 'base64') as any, {
    status: 200,
    headers: { 'Content-Type': match[1], 'Cache-Control': 'private, max-age=300' },
  });
}
