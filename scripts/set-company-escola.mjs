/**
 * Define a empresa "Espaço Educacional Progredir" para os 9 membros da escola.
 * NÃO RODADO. Padrão = dry-run (só mostra). Para gravar: node scripts/set-company-escola.mjs --apply
 * Grava em profileJson.company (não precisa de migração). Só imprime log no console;
 * prefira trocar pela tela Pessoas (fica na trilha de auditoria) se possível.
 * --column: além do profileJson, grava na coluna User.company (somente depois de aplicar a migração pendente).
 * Nunca altera batidas.
 */
import { PrismaClient } from '@prisma/client';

const ESCOLA = [
  'Cássio Freire de Oliveira', 'Daniele de Souza Tavares', 'Edilson Teixeira', 'Gabriela Pereira dos Santos Araujo',
  'José Ulian da Silva Inácio', 'Julyanne Felippe de Aguiar', 'Leonardo de Oliveira Dias', 'Nathalia de Lima Lomba',
  'Robson de Souza Santos',
];
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const apply = process.argv.includes('--apply');
const column = process.argv.includes('--column');
const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({ where: { role: 'EMPLOYEE' }, select: { id: true, name: true, profileJson: true } });
  const byName = new Map(users.map((u) => [norm(u.name), u]));
  const missing = [];
  for (const name of ESCOLA) {
    const u = byName.get(norm(name));
    if (!u) { missing.push(name); continue; }
    let prof = {};
    try { prof = u.profileJson ? JSON.parse(u.profileJson) : {}; } catch { prof = {}; }
    const from = prof.company || 'ESPACO_PROGREDIR';
    console.log(`${apply ? 'GRAVANDO' : 'dry-run'}: ${u.name}  ${from} -> ESPACO_EDUCACIONAL_PROGREDIR`);
    if (apply && from !== 'ESPACO_EDUCACIONAL_PROGREDIR') {
      await prisma.user.update({ where: { id: u.id }, data: { profileJson: JSON.stringify({ ...prof, company: 'ESPACO_EDUCACIONAL_PROGREDIR' }) } });
    }
    if (apply && column) await prisma.$executeRawUnsafe('UPDATE "User" SET "company" = $1 WHERE "id" = $2', 'ESPACO_EDUCACIONAL_PROGREDIR', u.id);
  }
  if (missing.length) console.warn('Não encontrados (conferir grafia):', missing.join(', '));
} finally { await prisma.$disconnect(); }
