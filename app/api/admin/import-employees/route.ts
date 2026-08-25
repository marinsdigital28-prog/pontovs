import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';



export const dynamic = 'force-dynamic';



const profiles: Record<string, { jobTitle: string; workDays: string }> = {
  '2904': { jobTitle: 'COZINHEIRO', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '0506': { jobTitle: 'VICE DIRETOR', workDays: 'Ter, Qui, Sex' },
  '0043': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '0026': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg a Sex (Afastado por Cirurgia)' },
  '2203': { jobTitle: 'ARTESANATO', workDays: 'Sex' },
  '0042': { jobTitle: 'PSICOPEDAGOGA', workDays: 'Qua, Qui' },
  '1705': { jobTitle: 'SECRETÁRIO ESCOLAR', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '1701': { jobTitle: 'COZINHEIRA', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '0029': { jobTitle: 'PROFESSORA DE EDUCAÇÃO FÍSICA', workDays: 'Ter, Qua, Qui' },
  '0050': { jobTitle: 'AUXILIAR DE SERVIÇOS GERAIS', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '3107': { jobTitle: 'CONTADORA DE HISTÓRIAS', workDays: 'Ter' },
  '0019': { jobTitle: 'INSTRUTOR DE MUSICA', workDays: 'Qui, Sex' },
  '0304': { jobTitle: 'PROFESSOR JIU JITSU', workDays: 'Ter, Qua, Qui' },
  '0028': { jobTitle: 'INSTRUTOR DE CAPOEIRA', workDays: 'Seg, Qua, Sex' },
  '2506': { jobTitle: 'AUXILIAR DE SERVIÇOS GERAIS', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '1811': { jobTitle: 'PSICOLOGA', workDays: 'Seg, Ter, Sex' },
  '2409': { jobTitle: 'PROFESSORA', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '0803': { jobTitle: 'JOVEM APRENDIZ', workDays: 'Seg, Qua, Qui, Sex' },
  '5050': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '4041': { jobTitle: 'ADMINISTRATIVO', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '0021': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'Ter, Qua, Qui' },
  '0011': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'Seg, Ter, Qua' },
  '1508': { jobTitle: 'PSICÓLOGA', workDays: 'Seg, Ter, Qui' },
  '0909': { jobTitle: 'PSICÓLOGA', workDays: 'Ter, Qua, Qui' },
  '0701': { jobTitle: 'CONTADORA', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '1910': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'Seg, Qua' },
  '0040': { jobTitle: 'PROFESSORA DE TEATRO', workDays: 'Seg, Sex' },
  '1807': { jobTitle: 'PSICOLOGA', workDays: 'Ter, Qui' },
  '5500': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '2201': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '5100': { jobTitle: 'FONOAUDIÓLOGA', workDays: 'Seg, Qua' },
  '2611': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '1404': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'Seg, Ter, Qua, Qui, Sex' },
  '2020': { jobTitle: 'INSTRUTOR DE DESENHO', workDays: 'Seg, Qua' },
};

const employees = [
  
  ['ANA MARIA DOS SANTOS CAVALCANTE', '2904'],
  
  ['CÁSSIO FREIRE DE OLIVEIRA', '0506'],
  
  ['CRISTIANO DOS SANTOS SILVA', '0043'],
  
  ['CRISTIANO FERREIRA DA SILVA', '0026'],
  
  ['DANIELE DE SOUZA TAVARES', '2203'],
  
  ['DILMA LOPES DOS SANTOS', '0042'],
  
  ['EDILSON TEIXEIRA', '1705'],
  
  ['ELISABETE GOMES DA SILVA', '1701'],
  
  ['ELISANGELA DA SILVA CRUZ', '0029'],
  
  ['ELISANGELA REIS COSTA CASTRO', '0050'],
  
  ['GABRIELA PEREIRA DOS SANTOS ARAUJO', '3107'],
  
  ['GERMANO DA SILVA RIBEIRO', '0019'],
  
  ['GILVAN RODRIGUES DA SILVA', '0304'],
  
  ['JORGE EDUARDO MAIA SERAFIM', '0028'],
  
  ['JOSÉ ULIAN DA SILVA INÁCIO', '2506'],
  
  ['JOYCE SILVA DE SOUZA', '1811'],
  
  ['JULYANNE FELIPPE DE AGUIAR', '2409'],
  
  ['KAIO HENRIQUES DA SILVA VIANNA', '0803'],
  
  ['LEONARDO DE OLIVEIRA DIAS', '5050'],
  
  ['MAICON FERNANDES MARINS', '4041'],
  
  ['MARIA NIZELBA DUTRA DOS SANTOS', '0021'],
  
  ['MARIA REVIANE DANTAS DA SILVA RESENDE', '0011'],
  
  ['MARIÂNGELA SILVA DA CONCEIÇÃO', '1508'],
  
  ['MARIANNA RODRIGUES COUTO', '0909'],
  
  ['MERCIA MARQUES BATISTA', '0701'],
  
  ['NATHALIA DE LIMA LOMBA', '1910'],
  
  ['OHANA NATUREZA JUNQUEIRA PEREIRA', '0040'],
  
  ['RAYANE PATRICIO DE SOUZA CARVALHÃES', '1807'],
  
  ['RENATA DA CONCEIÇÃO FELIPPE DE SÁ', '5500'],
  
  ['ROBSON DE SOUZA SANTOS', '2201'],
  
  ['SUELEN JOSE PENHA MACHADO', '5100'],
  
  ['TAIANE RODRIGUES PINTO', '2611'],
  
  ['VIVIANE DE SOUZA GEREMIAS', '1404'],
  
  ['WALLACE COSTA DE CASTRO', '2020'],
  
] as const;



export async function POST(request: Request) {
  
  const token = request.headers.get('x-import-token');
  
  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    
  }
  

  
  try {
    
    for (const [name, employeeNumber] of employees) {
      
      const profile = profiles[employeeNumber];
      await prisma.user.upsert({
        
        where: { employeeNumber },
        
        update: { name, role: 'EMPLOYEE', active: true, jobTitle: profile?.jobTitle ?? null, workDays: profile?.workDays ?? null },
        
        create: {
          
          id: crypto.randomUUID(),
          
          name,
          
          employeeNumber,
          
          email: `${employeeNumber}@employee.local`,
          
          passwordHash: null,
          
          role: 'EMPLOYEE',
          
          active: true,
          jobTitle: profile?.jobTitle ?? null,
          workDays: profile?.workDays ?? null,
          
        },
        
      });
      
    }
    
    return NextResponse.json({ ok: true, imported: employees.length });
    
  } catch {
    
    return NextResponse.json({ error: 'Falha ao importar colaboradores' }, { status: 500 });
    
  }
  
}






























































