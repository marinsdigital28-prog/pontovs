# Plano e estado — Chamada por profissional no Módulo 3

## Experiência solicitada

- Manter Início, Jornada, Meu mês, Avisos e Perfil no Ponto; acrescentar uma única aba **Chamada** com indicador pulsante somente quando houver chamada atribuída e pendente para o profissional autenticado.
- Ligar a chamada ao fluxo do **Módulo 3**, sob a pasta visual **PRESENÇAS**, organizando configuração e histórico por perfil, programa, turma, atividade e horário.
- Usar somente beneficiários e turmas da fonte já apontada por `lib/beneficiarios-source.ts`; não criar dados, perfis, horários ou vínculos fictícios.
- Separar chamada geral de oficina; nenhuma atribuição automática. Psicologia não recebe observações ou dados clínicos.

## Implementação nesta branch

- `app/app/employee-shell.tsx`: preserva as cinco abas, acrescenta Chamada e consulta pendências periodicamente.
- `components/modulo3/CallAttendancePanel.tsx`: escolhe data e vínculo autorizado, exibe lista real filtrada e envia estados de presença.
- `app/modulo-3/presencas/page.tsx`: interface administrativa para perfis existentes, vínculos explícitos e histórico por período.
- APIs em `app/api/modulo-3/` e `app/api/admin/modulo-3/`: autorização server-side, rate limit, filtro de programa/faixa etária, lista e atribuição pela sessão do usuário.
- A configuração é namespaced em `User.profileJson.callAssignments`, preservando os demais campos do perfil e sem migration.
- As chamadas usam as chaves namespaced dentro de `listas_presenca.marcacoes` e `filtros`, preservando entradas legadas. Nenhuma alteração no banco foi executada nesta tarefa.
- O script de build só executa `prisma db push` em `VERCEL_ENV=production`; no Preview/Development ele é ignorado.
- `middleware.ts` bloqueia POST/PUT/PATCH/DELETE no Preview, exceto as rotas de autenticação. As APIs novas também informam modo somente leitura; a gravação só poderia ser habilitada mediante `CHAMADA_PREVIEW_WRITE_ENABLED=true` em ambiente isolado.

## Limite funcional que não será mascarado

O catálogo real de oficinas do projeto Supabase referenciado pelo Ponto não pôde ser verificado pelo conector disponível. A lista de atividades do anexo é exibida como requisito, não como comprovação de que determinada atividade está cadastrada. Por isso, a UI e a API bloqueiam a atribuição de oficinas até que se confirme, na fonte correta, a atividade associada à turma. A chamada geral por turma cadastrada permanece preparada.

O token da fonte de beneficiários está limitado ao ambiente Production; o Preview não terá acesso a essa lista. O conector não deu acesso ao esquema do projeto `pwnxvwpxvflgcpxkvwyw`. Portanto, o Preview deve mostrar estado de fonte indisponível, sem dados simulados. A integração Postgres da Vercel tem escopo Preview e Production, mas não foi verificado se os destinos são isolados; por segurança, a prévia fica somente para leitura e o build não aplica schema fora de Production.

## Validação e entrega

- Checagem TypeScript focada nos arquivos alterados: aprovada.
- Build completo: pendente.
- Deploy: Preview da branch somente; não publicar em produção.
- Depois que a fonte correta e o catálogo forem verificáveis, habilitar a configuração de oficinas com os nomes reais, e testar gravação apenas em banco de Preview isolado.
