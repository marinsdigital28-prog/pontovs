# TODO — Chamada por profissional no Módulo 3

- [x] **Aba Chamada:** preservar Início, Jornada, Meu mês, Avisos e Perfil; acrescentar uma única aba Chamada com pulso discreto quando houver pendência atribuída para o perfil da sessão. O pulso respeita `prefers-reduced-motion`.
- [x] **Escopo do colaborador:** obter o profissional da sessão autenticada e mostrar somente os vínculos `callAssignments` desse perfil; não permitir que o cliente envie o nome do responsável.
- [x] **Programas e faixa etária:** suportar Espaço Crescer (10–14 anos) e Espaço Jovem (15–17 anos), calculados na data da chamada. O roster usa dados reais da fonte existente; não cria beneficiários nem listas de demonstração.
- [x] **Perfis:** usar colaboradores ativos já cadastrados e exibir o cargo do cadastro; não duplicar perfis nem distribuir oficinas automaticamente.
- [x] **Pasta PRESENÇAS:** criar entrada no Módulo 3, configuração por perfil e histórico com filtros mensais, sem consultar a tabela `presencas` de outro sistema.
- [x] **Proteção do Preview:** build pula `prisma db push` fora de Production; middleware bloqueia métodos mutáveis em Preview, exceto autenticação; novas gravações são somente leitura até haver fonte isolada.
- [ ] **Catálogo real das oficinas:** verificar na fonte correta quais atividades estão cadastradas e vinculadas a cada turma. Até isso ser possível, a lista do anexo não é tratada como cadastro e o servidor bloqueia vínculos de oficina. Inclui Educação Física, Capoeira, Futsal, Música, Teatro, Leitura, Desenho, Jiu-Jitsu, Fonoaudiologia e acompanhamento psicológico somente se cadastrado.
- [ ] **Validar fonte e gravação real:** o conector não acessou o esquema do projeto usado pelo Ponto; o token de beneficiários é Production-only. Confirmar o esquema e testar gravação apenas em banco isolado de Preview antes de habilitar oficinas ou chamadas.
- [ ] **Build e deploy Preview:** executar o build completo, publicar somente a branch de Preview e verificar a URL; não publicar em produção.
