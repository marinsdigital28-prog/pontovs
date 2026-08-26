# Diagnóstico da folha de ponto

O commit atual do GitHub é `0d7acbe` (`feat: add live printable timesheet`) e contém a aba `Folha de ponto` em `app/admin/admin-dashboard.tsx`.

A URL pública `https://ponto.marinsdistemas.xyz/admin` ainda exibe somente as abas antigas e não contém o texto `Folha de ponto`, confirmando que o domínio está servindo o deployment anterior.

No painel da Vercel, o projeto correto é `pontovs`, associado ao domínio `ponto.marinsdistemas.xyz`. A produção aparece no commit `f93288d`, apesar de o GitHub já estar no commit `0d7acbe`. Há também outros projetos/deployments, incluindo `pontovs-lmo6` com o domínio `ponto01.marinsdistemas.xyz`; esse não é o domínio principal.

O redeploy ainda não foi confirmado. Uma tentativa anterior abriu um preview antigo porque o menu da Vercel usa coordenadas diferentes das dimensões informadas pelo navegador. A próxima ação deve ser selecionar o item textual correto no menu do deployment ou usar a opção de redeploy disponível na página da produção e, depois, validar novamente o domínio principal.

## Bloqueio de publicação identificado

A tentativa direta de criar o deployment com o SHA completo `0d7acbe2091a67615ee0402ba8e915cbaf96125d` foi rejeitada pela Vercel com HTTP 402: limite de deployments da conta Hobby atingido (`api-deployments-free-per-day`, 100 deployments, remaining 0). O redeploy iniciado anteriormente usa o commit antigo `f93288d`, portanto não contém a Folha de ponto e não deve ser tratado como solução.

## Verificação de 26/08/2026

A lista de produção do projeto `pontovs` mostra um redeploy recente `2Lsz2pt7w56ozZZRrj4h1y8LVsmg` como Ready, porém a origem continua sendo o commit antigo `f93288d` (`fix: distinguish punch api errors from offline`). O commit da Folha de ponto ainda não foi publicado. O último retorno confirmado da API indicou limite diário da conta Hobby em 0/100, com reset previsto para `2026-08-27 00:54:40 UTC` (aproximadamente `2026-08-26 21:54:40` no horário de Brasília).

## Nova verificação de limite

A tentativa de publicar o commit atual `b13ee7e28fa41406505af5a17f9a3bffc39c84e4` também retornou HTTP 402 com `api-deployments-free-per-day`, `total: 100` e `remaining: 0`. A Vercel informou novo reset para `2026-08-27 01:15:04 UTC` (aproximadamente `2026-08-26 22:15:04` em Brasília). O deployment Ready continua sendo o redeploy do commit antigo `f93288d`.

## Deployment liberado

Em 26/08/2026, a Vercel aceitou a publicação do commit `b13ee7e28fa41406505af5a17f9a3bffc39c84e4` no projeto `pontovs`. A API retornou HTTP 200 e criou o deployment `dpl_7WeB1tYf4R59qWgmRG8G8Jz4B8MT`, com status inicial de construção (`buildingAt` preenchido), usando `target: production`, `ref: main` e o commit que contém a correção do menu móvel e os testes da Folha de ponto. A validação final ainda precisa aguardar o build e conferir o domínio principal.

## Publicação iniciada

A Vercel aceitou o deployment do commit `b13ee7e28fa41406505af5a17f9a3bffc39c84e4` com HTTP 200, indicando que o limite diário foi liberado. O deployment `7WeB1tYf4R59qWgmRG8G8Jz4B8MT` está em produção, usando `main`, e aparece como `Building`, com os domínios temporários `pontovs-git-main-marinsdigital28-8350s-projects.vercel.app` e `pontovs-jdxa2i27z-marinsdigital28-8350s-projects.vercel.app`. A compilação ainda está em andamento; a validação do domínio principal aguarda o status `Ready`.

## Deployment publicado

O deployment `7WeB1tYf4R59qWgmRG8G8Jz4B8MT` terminou como `Ready` em 31 segundos e foi marcado como `Latest` e `Production`. A Vercel atribuiu o domínio principal `ponto.marinsdistemas.xyz` ao commit `b13ee7e28fa41406505af5a17f9a3bffc39c84e4`. O build e a atribuição de domínio concluíram sem erro aparente; falta validar visualmente as rotas públicas do domínio.

## Validação do domínio principal

Após o deployment `7WeB1tYf4R59qWgmRG8G8Jz4B8MT` ficar `Ready`, o domínio `https://ponto.marinsdistemas.xyz/admin` passou a exibir a aba `Folha de ponto`. Ao clicar nela, a folha é renderizada com competência agosto de 2026, 34 colaboradores e os controles de impressão/atualização. Entretanto, a tela mostrou o aviso `Filtro inválido` e total de 0 registros, exigindo investigação da requisição inicial da API.
