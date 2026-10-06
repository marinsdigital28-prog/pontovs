# Módulo 3 — Beneficiários e chamada

O módulo 3 possui duas telas:

- `/modulo-3`: cadastro externo de beneficiários;
- `/modulo-3/presenca`: PWA instalável para professores fazerem a chamada.

## PWA de chamada

O professor informa o nome, escolhe a data e a turma. O portal consulta em tempo real os beneficiários ativos e as matrículas do sistema Lovable/Supabase.

Cada toque em **Presente**, **Falta**, **Justificado** ou **Não compareceu** envia imediatamente um `PATCH` para o portal, que atualiza a mesma lista na tabela `listas_presenca` do Supabase externo. A chamada, portanto, aparece no sistema externo sem exportação ou importação manual.

A primeira marcação do dia/turma cria a lista; as marcações seguintes atualizam a lista existente. A estrutura gravada é compatível com a lista de presença já existente no sistema Lovable: `mes`, `ano`, `turma_id`, `turma`, `educador`, `participantes`, `marcacoes` e `total_alunos`.

## Variáveis obrigatórias em produção

```env
BENEFICIARIOS_SUPABASE_URL=https://pwnxvwpxvflgcpxkvwyw.supabase.co
BENEFICIARIOS_SUPABASE_ACCESS_TOKEN=<token autorizado do projeto Supabase>
```

Como alternativa, use uma chave de serviço somente como variável secreta:

```env
BENEFICIARIOS_SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

O token/chave não é enviado ao celular. O PWA fala apenas com as rotas server-side do portal. Nunca use essas credenciais em `NEXT_PUBLIC_*`.

## Instalação no celular

1. Abrir `https://portalprogredir.org/modulo-3/presenca` no Chrome/Safari;
2. Escolher **Adicionar à tela inicial** ou **Instalar aplicativo**;
3. Abrir o ícone **Chamada** para usar a lista como aplicativo.

A versão inicial ainda não exige login individual de professor; o nome informado é salvo localmente no aparelho e enviado como responsável da chamada. A próxima camada recomendada é autenticar cada professor com PIN ou conta individual antes de liberar o uso amplo.
