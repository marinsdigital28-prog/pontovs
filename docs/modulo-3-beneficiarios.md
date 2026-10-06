# Módulo 3 — Beneficiários

A rota `/modulo-3` apresenta o cadastro de beneficiários do Espaço Progredir para preparar a futura chamada dos professores.

## Integração

A API interna `/api/modulo-3/beneficiarios` consulta a tabela `beneficiarios` do projeto Supabase usado pelo sistema Lovable. A primeira versão é **somente leitura**: não cria, edita, ativa ou inativa registros.

Configure no ambiente de produção do portal:

```env
BENEFICIARIOS_SUPABASE_URL=https://pwnxvwpxvflgcpxkvwyw.supabase.co
BENEFICIARIOS_SUPABASE_ACCESS_TOKEN=<token de leitura do projeto Supabase>
```

O token pode ser um token de sessão com permissão de leitura ou uma chave de serviço armazenada somente como variável secreta (`BENEFICIARIOS_SUPABASE_SERVICE_ROLE_KEY`). Nunca coloque essa chave em `NEXT_PUBLIC_*` e nunca a envie ao navegador.

A chave anônima pública do cliente externo permanece apenas como fallback técnico; no estado atual do Supabase ela não retorna os beneficiários sem uma sessão autorizada.

## Funcionalidades desta etapa

- Busca por nome, escola, bairro ou código;
- Filtro de ativos, inativos e todos;
- Paginação server-side;
- Ficha resumida do beneficiário;
- Dados lidos em tempo real da fonte externa;
- Atalho no manifesto instalável do PWA.

A chamada dos professores será a próxima etapa e usará a mesma fonte de beneficiários, associando participantes às turmas/matrículas antes de gravar frequência.
