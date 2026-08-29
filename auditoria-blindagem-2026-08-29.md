# Auditoria de blindagem do sistema de ponto

**Repositório:** `marinsdigital28-prog/pontovs`  
**Branch analisada:** `main`  
**Data:** 29 de agosto de 2026

## Escopo

Foi realizada uma inspeção estática da arquitetura, do esquema Prisma, das rotas de identificação, registro de ponto, portal do colaborador e painel administrativo, além da execução da suíte de testes e da compilação de produção. A análise priorizou persistência, idempotência, comportamento offline, autenticação, timezone, folha e regressões.

## Resultado da validação

| Verificação | Resultado |
|---|---:|
| Testes Vitest | **52 aprovados, 2 ignorados** |
| Suíte após correção | **19 arquivos aprovados, 2 ignorados** |
| Build de produção Next.js | **Concluído com sucesso** |
| `git diff --check` | **Sem erros de whitespace** |
| Alteração funcional | **3 reforços mínimos** |

## Correção aplicada

A sincronização offline descartava qualquer resposta HTTP `409` como se ela confirmasse que a marcação já estava persistida. Porém, a API usa `409` também para concorrência e jornada encerrada. Nesses casos, remover o item de `localStorage` poderia perder a única evidência local de uma marcação não confirmada.

A rotina agora mantém **toda resposta não bem-sucedida**, inclusive `409`, na fila local. O item só é removido quando a API responde com sucesso — inclusive o caso idempotente de `clientId` já existente, que a API responde com `200`.

Arquivos alterados:

- `app/ponto/page.tsx`: preservação de pendências quando a sincronização retorna erro.
- `tests/timesheet-navigation.test.ts`: contrato atualizado para proteger o novo comportamento.
- `app/api/identify/route.ts`: rate limiting da identificação pública.
- `app/api/punch/route.ts`: rate limiting da gravação pública.
- `tests/security-controls.test.ts`: cobertura dos limites nas rotas públicas.

## Reforços aplicados nesta etapa

Como a regra operacional escolhida foi manter o portal por matrícula sem senha, o fluxo não foi removido. Foram adicionados limites de requisições por IP nas rotas públicas de identificação (`120 requisições por minuto`) e gravação de ponto (`120 requisições por minuto`). Quando o limite é excedido, a API responde `429`, informa `Retry-After` e impede que o frontend fique sem uma resposta clara.

Essa proteção reduz enumeração automatizada de matrículas e abuso de chamadas sem alterar a operação normal do totem. Também foram adicionados testes de contrato para garantir que os dois endpoints continuem usando o mecanismo de limitação.

## Achados que não foram alterados automaticamente

### Autenticação por matrícula

`lib/auth.ts` permite que o provedor de credenciais autentique um usuário com `employeeNumber` sem exigir senha. A tela administrativa envia apenas senha, e o registro de ponto usa uma rota própria sem sessão; portanto, não alterei esse comportamento sem confirmar a regra operacional pretendida. Ainda assim, a rota de credenciais deve ser revisada antes de considerar o sistema protegido contra impersonação, pois uma chamada direta ao endpoint de autenticação pode tentar obter uma sessão de colaborador conhecendo apenas a matrícula.

### Semântica de marcações offline

O cliente armazena `clientTimestamp`, mas `app/api/punch/route.ts` define o horário oficial com `new Date()` quando a marcação é sincronizada. Isso evita confiar cegamente no relógio do aparelho, mas significa que uma marcação feita sem conexão pode receber o horário de sincronização, não o horário original. Uma mudança para usar o horário do cliente seria uma decisão de negócio e segurança; não foi feita automaticamente.

### Concorrência no registro online

A API usa transação `Serializable`, chave única para `clientId` e trata conflitos `P2002`/`P2034` como `409`. A proteção está presente, mas requer teste de integração contra o banco PostgreSQL real para validar o comportamento sob duas requisições simultâneas, pois a suíte atual é predominantemente unitária/estática.

### Dependências e lockfile

`npm ci` não foi executável porque o lockfile versionado não contém todas as dependências exigidas pelo `package.json`. Para a validação local, as dependências foram instaladas com `npm install --no-package-lock`, sem alterar o lockfile. Essa inconsistência deve ser corrigida em uma mudança separada e revisada, pois atualizar o lockfile pode alterar versões transitivas.

## Conclusão

As correções aplicadas são pequenas, diretamente justificadas por riscos de perda de dados e abuso de endpoints, e foram validadas por testes e build. Não foram feitas alterações cosméticas, migrações, troca de framework ou reescrita de arquitetura. Antes do uso operacional, recomenda-se tratar separadamente a política de autenticação por matrícula, definir formalmente o horário oficial de marcações offline e executar testes de integração/concor­rência em ambiente PostgreSQL equivalente ao de produção.
