import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';



export const dynamic = 'force-dynamic';



const profiles: Record<string, { jobTitle: string; workDays: string; scheduleStart: string; scheduleEnd: string }> = {
  '2904': { jobTitle: 'COZINHEIRO', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:29', scheduleEnd: '16:31' },
  '0506': { jobTitle: 'VICE DIRETOR', workDays: 'TER,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '16:31' },
  '0043': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:01' },
  '0026': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '17:00' },
  '2203': { jobTitle: 'ARTESANATO', workDays: 'SEX', scheduleStart: '08:00', scheduleEnd: '17:00' },
  '0042': { jobTitle: 'PSICOPEDAGOGA', workDays: 'QUA,QUI', scheduleStart: '07:57', scheduleEnd: '17:03' },
  '1705': { jobTitle: 'SECRETÁRIO ESCOLAR', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '11:32' },
  '1701': { jobTitle: 'COZINHEIRA', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:58', scheduleEnd: '17:01' },
  '0029': { jobTitle: 'PROFESSORA DE EDUCAÇÃO FÍSICA', workDays: 'TER,QUA,QUI', scheduleStart: '07:58', scheduleEnd: '17:01' },
  '0050': { jobTitle: 'AUXILIAR DE SERVIÇOS GERAIS', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:02' },
  '3107': { jobTitle: 'CONTADORA DE HISTÓRIAS', workDays: 'TER', scheduleStart: '11:57', scheduleEnd: '16:04' },
  '0019': { jobTitle: 'INSTRUTOR DE MUSICA', workDays: 'QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:02' },
  '0304': { jobTitle: 'PROFESSOR JIU JITSU', workDays: 'TER,QUA,QUI', scheduleStart: '08:01', scheduleEnd: '17:00' },
  '0028': { jobTitle: 'INSTRUTOR DE CAPOEIRA', workDays: 'SEG,QUA,SEX', scheduleStart: '07:58', scheduleEnd: '17:01' },
  '2506': { jobTitle: 'AUXILIAR DE SERVIÇOS GERAIS', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '06:58', scheduleEnd: '16:01' },
  '1811': { jobTitle: 'PSICOLOGA', workDays: 'SEG,TER,SEX', scheduleStart: '07:56', scheduleEnd: '17:02' },
  '2409': { jobTitle: 'PROFESSORA', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:26', scheduleEnd: '11:32' },
  '0803': { jobTitle: 'JOVEM APRENDIZ', workDays: 'SEG,QUA,QUI,SEX', scheduleStart: '08:00', scheduleEnd: '15:02' },
  '5050': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:29', scheduleEnd: '11:31' },
  '4041': { jobTitle: 'ADMINISTRATIVO', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:00' },
  '0021': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'TER,QUA,QUI', scheduleStart: '07:58', scheduleEnd: '17:01' },
  '0011': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'SEG,TER,QUA', scheduleStart: '07:59', scheduleEnd: '17:01' },
  '1508': { jobTitle: 'PSICÓLOGA', workDays: 'SEG,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:01' },
  '0909': { jobTitle: 'PSICÓLOGA', workDays: 'TER,QUA,QUI', scheduleStart: '08:01', scheduleEnd: '17:00' },
  '0701': { jobTitle: 'CONTADORA', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '09:30', scheduleEnd: '17:01' },
  '1910': { jobTitle: 'ASSISTENTE SOCIAL', workDays: 'SEG,QUA', scheduleStart: '07:58', scheduleEnd: '17:02' },
  '0040': { jobTitle: 'PROFESSORA DE TEATRO', workDays: 'SEG,SEX', scheduleStart: '07:58', scheduleEnd: '17:02' },
  '1807': { jobTitle: 'PSICOLOGA', workDays: 'TER,QUI', scheduleStart: '07:57', scheduleEnd: '17:03' },
  '5500': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:57', scheduleEnd: '17:01' },
  '2201': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:28', scheduleEnd: '16:32' },
  '5100': { jobTitle: 'FONOAUDIÓLOGA', workDays: 'SEG,QUA', scheduleStart: '07:55', scheduleEnd: '17:01' },
  '2611': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:58', scheduleEnd: '17:01' },
  '1404': { jobTitle: 'EDUCADOR SOCIAL', workDays: 'SEG,TER,QUA,QUI,SEX', scheduleStart: '07:56', scheduleEnd: '17:01' },
  '2020': { jobTitle: 'INSTRUTOR DE DESENHO', workDays: 'SEG,QUA', scheduleStart: '07:58', scheduleEnd: '17:00' },
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
        
        update: { name, role: 'EMPLOYEE', active: true, jobTitle: profile?.jobTitle ?? null, workDays: profile?.workDays ?? null, scheduleStart: profile?.scheduleStart ?? null, scheduleEnd: profile?.scheduleEnd ?? null },
        
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
          scheduleStart: profile?.scheduleStart ?? null,
          scheduleEnd: profile?.scheduleEnd ?? null,
          
        },
        
      });
      
    }
    
    return NextResponse.json({ ok: true, imported: employees.length });
    
  } catch {
    
    return NextResponse.json({ error: 'Falha ao importar colaboradores' }, { status: 500 });
    
  }
  
}






























































