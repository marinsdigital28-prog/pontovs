# Diagnóstico da folha de ponto

O commit atual do GitHub é `0d7acbe` (`feat: add live printable timesheet`) e contém a aba `Folha de ponto` em `app/admin/admin-dashboard.tsx`.

A URL pública `https://ponto.marinsdistemas.xyz/admin` ainda exibe somente as abas antigas e não contém o texto `Folha de ponto`, confirmando que o domínio está servindo o deployment anterior.

No painel da Vercel, o projeto correto é `pontovs`, associado ao domínio `ponto.marinsdistemas.xyz`. A produção aparece no commit `f93288d`, apesar de o GitHub já estar no commit `0d7acbe`. Há também outros projetos/deployments, incluindo `pontovs-lmo6` com o domínio `ponto01.marinsdistemas.xyz`; esse não é o domínio principal.

O redeploy ainda não foi confirmado. Uma tentativa anterior abriu um preview antigo porque o menu da Vercel usa coordenadas diferentes das dimensões informadas pelo navegador. A próxima ação deve ser selecionar o item textual correto no menu do deployment ou usar a opção de redeploy disponível na página da produção e, depois, validar novamente o domínio principal.

## Bloqueio de publicação identificado

A tentativa direta de criar o deployment com o SHA completo `0d7acbe2091a67615ee0402ba8e915cbaf96125d` foi rejeitada pela Vercel com HTTP 402: limite de deployments da conta Hobby atingido (`api-deployments-free-per-day`, 100 deployments, remaining 0). O redeploy iniciado anteriormente usa o commit antigo `f93288d`, portanto não contém a Folha de ponto e não deve ser tratado como solução.
