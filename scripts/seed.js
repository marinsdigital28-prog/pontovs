require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  const email = 'admin@local';
  const employeeNumber = '4041';
  const hash = await bcrypt.hash('password', 10);

  const existingByEmail = await prisma.user.findUnique({ where: { email } });
  const existingByNumber = await prisma.user.findUnique({ where: { employeeNumber } });
  const existing = existingByEmail || existingByNumber;

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: 'Maicon Fernandes Marins',
        employeeNumber,
        email,
        passwordHash: hash,
        role: 'EMPLOYEE',
      },
    });
    console.log('Updated user:', updated.name, 'matrícula:', updated.employeeNumber, 'cargo: Auxiliar Administrativo');
    return;
  }

  const user = await prisma.user.create({
    data: {
      name: 'Maicon Fernandes Marins',
      employeeNumber,
      email,
      passwordHash: hash,
      role: 'EMPLOYEE',
    }
  });
  console.log('Created user:', user.name, 'matrícula:', user.employeeNumber, 'cargo: Auxiliar Administrativo');
}

main()
  .catch((e)=>{ console.error(e); process.exit(1); })
  .finally(async ()=>{ await prisma.$disconnect(); });
