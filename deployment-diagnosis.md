# Diagnóstico do deployment de 25/08/2026

O deployment da senha única chegou ao projeto Vercel correto e ficou pronto após corrigir o schema Prisma. A API administrativa, porém, retornava HTTP 500 ao consultar `/api/admin/punches`, porque a coluna `photoData` ainda não estava aplicada no banco de produção.

Foi adicionado `prisma migrate deploy` ao comando de build para aplicar a migration automaticamente. O deployment seguinte falhou nesse passo, conforme os logs da Vercel: o comando executado foi `npx prisma generate && npm run build`, e o `npm run build` iniciou `prisma migrate deploy` contra o PostgreSQL Neon. A etapa de migration falhou antes do `next build`, deixando o deployment em erro.

O deployment pronto anterior continua atendendo o domínio. A tela de login já exibe apenas o campo de senha e o login testado abriu o painel. A correção restante é ajustar a estratégia de migration para não bloquear o build de produção e aplicar a coluna `photoData` de forma segura.

## Revisão dos relatórios — 25/08/2026

A revisão foi enviada ao GitHub no commit `a1734d8` do repositório `https://github.com/marinsdigital28-prog/pontovs`. O build local passou com Vitest, TypeScript e Next.js. Na consulta à lista de deployments da Vercel, o deployment de produção mais recente ainda aparecia como `f93288d`; o novo commit ainda não estava visível como deployment processado no momento da verificação.

## Verificação de produção — 25/08/2026 23:08

A Vercel continua mostrando `f93288d` como o deployment mais recente marcado como `Production` para o projeto `pontovs`. O commit mais novo da revisão de relatórios, `a1734d8`, não aparece na lista atual de deployments. Portanto, a produção ainda não foi atualizada com a revisão dos relatórios.

## Teste autorizado da matrícula 4041 — 25/08/2026 23:21

No domínio de produção, a matrícula `4041` foi reconhecida como MAICON FERNANDES MARINS e o fluxo avançou para a etapa da câmera. A abertura da câmera não pôde prosseguir no ambiente automatizado porque `navigator.mediaDevices.getUserMedia` retornou `NotFoundError: Requested device not found`; o ambiente de teste não possui dispositivo de câmera. Não foi criada uma nova batida durante esse teste. A validação do salvamento no PostgreSQL precisa ser concluída no celular com câmera real, ou com uma autorização separada para registrar uma batida real por outro meio.
