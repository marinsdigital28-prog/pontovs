import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';



export const dynamic = 'force-dynamic';



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
      
      await prisma.user.upsert({
        
        where: { employeeNumber },
        
        update: { name, role: 'EMPLOYEE', active: true },
        
        create: {
          
          id: crypto.randomUUID(),
          
          name,
          
          employeeNumber,
          
          email: `${employeeNumber}@employee.local`,
          
          passwordHash: null,
          
          role: 'EMPLOYEE',
          
          active: true,
          
        },
        
      });
      
    }
    
    return NextResponse.json({ ok: true, imported: employees.length });
    
  } catch {
    
    return NextResponse.json({ error: 'Falha ao importar colaboradores' }, { status: 500 });
    
  }
  
}






























































