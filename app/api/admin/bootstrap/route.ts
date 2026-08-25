import { NextResponse } from 'next/server';

import bcrypt from 'bcryptjs';

import prisma from '@/lib/prisma';



export const dynamic = 'force-dynamic';



export async function POST() {
  
  try {
    
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    
    const password = process.env.ADMIN_PASSWORD;
    

    
    if (!email || !password) {
      
      return NextResponse.json({ error: 'Configuração do gestor ausente' }, { status: 503 });
      
    }
    

    
    if (password.length < 10) {
      
      return NextResponse.json({ error: 'A senha do gestor precisa ter pelo menos 10 caracteres' }, { status: 400 });
      
    }
    

    
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "employeeNumber" TEXT UNIQUE, "email" TEXT UNIQUE NOT NULL, "passwordHash" TEXT, "role" TEXT NOT NULL DEFAULT \'EMPLOYEE\', "active" BOOLEAN NOT NULL DEFAULT true, "unitId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    

    
    const passwordHash = await bcrypt.hash(password, 12);
    
    const user = await prisma.user.upsert({
      
      where: { email },
      
      update: { passwordHash, role: 'ADMIN', active: true, name: 'Administrador' },
      
      create: { id: crypto.randomUUID(), email, passwordHash, role: 'ADMIN', active: true, name: 'Administrador' },
      
      select: { id: true, email: true, role: true, active: true },
      
    });
    

    
    return NextResponse.json({ ok: true, user });
    
  } catch {
    
    return NextResponse.json({ error: 'Não foi possível criar o gestor. Verifique a conexão PostgreSQL e tente novamente.' }, { status: 500 });
    
  }
  
}




























