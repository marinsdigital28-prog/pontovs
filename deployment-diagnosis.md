# Diagnóstico do deployment de 25/08/2026

O deployment da senha única chegou ao projeto Vercel correto e ficou pronto após corrigir o schema Prisma. A API administrativa, porém, retornava HTTP 500 ao consultar `/api/admin/punches`, porque a coluna `photoData` ainda não estava aplicada no banco de produção.

Foi adicionado `prisma migrate deploy` ao comando de build para aplicar a migration automaticamente. O deployment seguinte falhou nesse passo, conforme os logs da Vercel: o comando executado foi `npx prisma generate && npm run build`, e o `npm run build` iniciou `prisma migrate deploy` contra o PostgreSQL Neon. A etapa de migration falhou antes do `next build`, deixando o deployment em erro.

O deployment pronto anterior continua atendendo o domínio. A tela de login já exibe apenas o campo de senha e o login testado abriu o painel. A correção restante é ajustar a estratégia de migration para não bloquear o build de produção e aplicar a coluna `photoData` de forma segura.
