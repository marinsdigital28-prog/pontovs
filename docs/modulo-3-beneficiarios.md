# Módulo 3 — Beneficiários e PRESENÇAS

O Módulo 3 mantém a fonte de beneficiários já configurada no Ponto. A organização de chamadas fica em **Módulo 3 → PRESENÇAS** (`/modulo-3/presencas`), e o profissional acessa a própria chamada pela aba **Chamada** do Ponto (`/app`) ou pela rota `/modulo-3/presenca`.

## Acesso e atribuições

A identidade do profissional vem da sessão NextAuth. As rotas conferem no servidor se a conta está ativa, se o colaborador existe e se a chamada pertence a um vínculo salvo para aquele perfil. O colaborador não informa o nome do responsável e não recebe as chamadas de outras pessoas.

Administradores e gestores ativos podem consultar os perfis e configurar vínculos explícitos. A configuração é armazenada na propriedade namespaced `callAssignments` de `User.profileJson`, mesclando o JSON existente sem migration. Não há criação automática de profissionais, turmas, horários ou vínculos.

## Programas e registro

O roster utiliza a fonte existente de turmas, beneficiários e matrículas. As faixas são Espaço Crescer (10–14 anos) e Espaço Jovem (15–17 anos), calculadas na data da chamada. O app não gera listas de demonstração. Cada sessão identifica data, programa, tipo de chamada, turma, turno, horário e profissional; as marcações ficam em chaves namespaced dentro de `listas_presenca.marcacoes`, com metadados em `filtros`, preservando o conteúdo legado.

As situações disponíveis são Presente, Falta, Justificado e Não compareceu. O fluxo não carrega nem exibe observações clínicas ou registros psicológicos.

## Catálogo de oficinas — pendência de verificação

As atividades que devem ser contempladas, conforme a especificação, são Educação Física, Capoeira, Futsal, Música, Teatro, Leitura, Desenho, Jiu-Jitsu, Fonoaudiologia e acompanhamento psicológico quando cadastrado como atendimento ou atividade. A lista de requisitos não comprova que cada atividade exista no catálogo da fonte.

O esquema/catálogo do projeto Supabase usado pelo Ponto ainda não pôde ser confirmado. Por segurança, a interface não grava vínculos de oficina enquanto não puder verificar a atividade real associada à turma; a API também rejeita esse tipo de vínculo. Não criar uma atividade, turma ou horário para contornar a ausência do catálogo.

## Preview e banco

O Preview é somente para leitura. O build ignora `prisma db push` fora de Production e o middleware bloqueia POST, PUT, PATCH e DELETE em Preview, exceto autenticação. As APIs novas deixam explícito quando não podem gravar. Não habilitar `CHAMADA_PREVIEW_WRITE_ENABLED` sem conectar e verificar uma fonte de dados isolada para Preview.

A fonte de beneficiários tem credencial de Production; ela não deve ser copiada ao Preview. Não foi executada nenhuma gravação ou migration do banco durante a implementação.
