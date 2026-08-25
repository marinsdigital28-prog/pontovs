import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const rows = await prisma.user.findMany({
    where: { employeeNumber: { in: ['0000', '0043', '43'] } },
    select: { employeeNumber: true, name: true, role: true, active: true, email: true },
  });
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await prisma.$disconnect();
}
