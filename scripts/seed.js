require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const hash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const data = { name: 'Gestor do Sistema', email, passwordHash: hash, role: 'MANAGER', active: true };
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data });
    console.log('Manager updated:', email);
  } else {
    await prisma.user.create({ data });
    console.log('Manager created:', email);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
