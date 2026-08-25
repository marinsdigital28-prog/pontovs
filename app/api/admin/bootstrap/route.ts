import { NextResponse } from 'next/server';

import bcrypt from 'bcryptjs';

import prisma from '@/lib/prisma';



export async function POST() {
  
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  
  const password = process.env.ADMIN_PASSWORD;
  

  
  if (!email || !password) {
    
    return NextResponse.json({ error: 'Configuração do gestor ausente' }, { status: 503 });
    
  }
  

  
  if (password.length < 10) {
    
    return NextResponse.json({ error: 'A senha do gestor precisa ter pelo menos 10 caracteres' }, { status: 400 });
    
  }
  

  
  const passwordHash = await bcrypt.hash(password, 12);
  
  const user = await prisma.user.upsert({
    
    where: { email },
    
    update: { passwordHash, role: 'ADMIN', active: true, name: 'Administrador' },
    
    create: { email, passwordHash, role: 'ADMIN', active: true, name: 'Administrador' },
    
    select: { id: true, email: true, role: true, active: true },
    
  });
  

  
  return NextResponse.json({ ok: true, user });
  
}






















