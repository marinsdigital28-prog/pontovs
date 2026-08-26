# Auditoria do Painel Administrativo — Ponto Progredir

**Data:** 26/08/2026  
**Escopo:** `/admin`, APIs administrativas, folha individual, relatórios e modelo Prisma.  
**Objetivo:** identificar o que já está funcional e o que falta para operar como um sistema profissional de controle de jornada.

## Resumo executivo

O painel já possui uma boa base operacional: autenticação de gestor, visão geral, cadastro e ativação de colaboradores, consulta de registros com filtros, exportação CSV, consulta de inconsistências, folha individual e impressão em formato A4. O ponto mais importante é que a estrutura atual ainda é de um **MVP operacional**. Ela permite consultar e corrigir a rotina básica, mas não possui entidades e fluxos necessários para aprovação, fechamento mensal, autosserviço autenticado do colaborador, auditoria completa e governança de alterações.

A prioridade máxima antes de colocar o sistema em uso amplo é reforçar a autenticação e a autorização, validar todos os dados no servidor, criar trilha de auditoria para colaboradores e jornadas e resolver a dependência de produção do PostgreSQL. A segunda prioridade é transformar o painel de consulta em um fluxo de operação: revisão, ajuste justificado, aprovação, fechamento e exportação oficial.

## O que já existe

| Área | Situação atual | Avaliação |
|---|---|---|
| Visão geral | Indicadores de colaboradores, marcações do dia e inconsistências abertas | Base boa, mas ainda sem métricas de atrasos, faltas, horas e saúde da operação |
| Colaboradores | CRUD, busca, ativar/desativar e dados básicos de jornada | Funcional, porém com validação e auditoria insuficientes |
| Turnos e jornada | Lista de dias e horários e atalho para edição | Consulta útil, mas não há histórico nem aprovação de mudanças |
| Registros | Filtros por período, colaborador, tipo e status; CSV; indicação de foto | Funcional, porém limitado a 1.000 linhas e sem paginação ou correção controlada |
| Folha de ponto | Folha individual, calendário diário, horas trabalhadas/previstas, saldo, faltas, atrasos e impressão | Boa base visual, mas cálculos e fechamento ainda não são formalizados |
| Inconsistências | Lista de pendências abertas e resolução simples | Existe o fluxo mínimo, mas falta justificativa, severidade e histórico |
| Fotos | Link autorizado para evidência fotográfica | Útil para conferência, mas requer storage dedicado, retenção e controles de acesso |
| Atualização | Folha atualiza a cada 10 segundos | Adequado como polling inicial; não é tempo real verdadeiro |

## Lacunas críticas

| Prioridade | Lacuna | Risco | Recomendação |
|---|---|---|---|
| P0 | Autenticação administrativa compartilhada por uma única senha | Não identifica qual gestor acessou ou alterou dados; dificulta revogação e aumenta impacto de vazamento | Criar usuários gestores individuais, hash de senha, recuperação segura, limite de tentativas, 2FA opcional e auditoria de login |
| P0 | Validação incompleta na API de colaboradores | CPF, e-mail, unidade, dias e horários podem ser gravados em formato incorreto | Reutilizar o validador compartilhado no servidor e no cliente; impor constraints e mensagens de erro consistentes |
| P0 | Alterações de cargo e jornada entram diretamente no cadastro | Uma mudança equivocada pode alterar o cálculo da folha e a escala oficial | Criar solicitação de alteração com status PENDENTE, aprovação, rejeição, motivo, autor e vigência |
| P0 | Ausência de modelos para solicitações e fechamento | O portal do colaborador não pode persistir solicitações de forma auditável | Criar entidades `EmployeeRequest`, `Absence`, `ShiftSwap`, `ProfileChangeRequest` e `TimesheetClosure` |
| P0 | Produção depende de deployment que ainda está bloqueado | Importador, portal e correções não estão disponíveis no domínio | Resolver limite da Vercel ou migrar a publicação; publicar um único commit e validar as variáveis de produção |
| P1 | Relatório limita a 1.000 registros e não tem paginação | Pode ocultar dados em períodos longos | Implementar paginação, total real, filtros persistentes e exportação assíncrona para lotes grandes |
| P1 | Correção de marcação não está disponível | Erros de batida exigem intervenção externa ou alteração manual no banco | Criar ação “Corrigir marcação” com tipo, data/hora, motivo, autor, aprovação e `PunchAudit` obrigatório |
| P1 | Inconsistência só pode ser aberta/resolvida | Não há classificação nem investigação | Adicionar severidade, categoria, responsável, observação de resolução, anexos e histórico de reabertura |
| P1 | Folha não possui fechamento oficial | O saldo pode mudar depois de uma conferência informal | Adicionar status ABERTA/EM_REVISÃO/FECHADA, responsável, data, assinatura e bloqueio após fechamento |
| P1 | Dados pessoais estão incompletos | Não há data de nascimento, WhatsApp, unidade detalhada ou preferências de contato no modelo | Adicionar campos necessários com controle de acesso e mascaramento; evitar dados desnecessários |
| P1 | Evidência fotográfica armazenada como texto no banco | Pode aumentar o banco, dificultar backup e elevar custo | Mover imagens para storage privado, guardar metadados e URL assinada de curta duração |
| P2 | Dashboard não apresenta indicadores de gestão | O gestor precisa abrir várias abas para entender a situação | Adicionar presença hoje, faltas previstas, atrasos, horas extras, saldo, pendências e tendência mensal |
| P2 | Falta importação com relatório de resultado no próprio painel | A carga histórica depende de script externo | Criar tela de importação com preview, validação, duplicidades, erros por linha e relatório final |
| P2 | Falta controle por unidade e permissões granulares | Um gestor pode visualizar mais dados do que deveria | Restringir por unidade e adicionar permissões como `VIEW_PUNCHES`, `EDIT_EMPLOYEES`, `APPROVE_REQUESTS`, `CLOSE_TIMESHEET` |
| P2 | Não há notificações | Solicitações podem ficar sem resposta | Criar central de notificações, e-mail/WhatsApp opcional e lembretes de pendências |

## Problemas técnicos observados

A autenticação usa um único provedor de credenciais e escolhe o primeiro gestor ativo. Isso é suficiente para um acesso inicial, mas não é adequado para responsabilização individual. A API administrativa protege o acesso por sessão, porém os endpoints de cadastro aceitam vários campos sem validação de domínio e não criam auditoria de alterações de colaborador.

O relatório de marcações usa `take: 1000`, portanto um período grande pode retornar uma visão incompleta sem deixar claro que existem mais páginas. O CSV também é gerado na mesma requisição. A solução profissional deve informar o total real e oferecer paginação ou exportação em lote.

A folha calcula horas a partir de pares de marcações, mas não há uma política formal para marcações incompletas, jornadas que atravessam meia-noite, intervalos irregulares, folgas autorizadas ou ajustes aprovados. Antes do fechamento oficial, essas regras precisam ser codificadas e cobertas por testes de casos reais.

O modelo Prisma contém `PunchAudit`, mas não possui auditoria para alterações em `User`, `Unit`, jornada, aprovação, fechamento ou inconsistência. Também não existem entidades de ausência, troca de dia, perfil, notificações ou assinatura de folha. Isso significa que essas funções não devem ser apenas botões na interface; precisam de tabelas e estados próprios.

## Plano recomendado

### Fase 1 — Segurança e integridade

Criar gestores individuais; reforçar o login; aplicar validação compartilhada na API; adicionar constraints de CPF, e-mail, matrícula e unidade; criar auditoria completa; configurar rate limiting; revisar variáveis de produção; e confirmar backup e restauração do PostgreSQL.

### Fase 2 — Operação diária

Adicionar dashboard com presença, faltas, atrasos e saldo; implementar correção controlada de marcações; criar fluxo completo de inconsistências; melhorar filtros e paginação; permitir exportação oficial; e configurar armazenamento privado das fotos.

### Fase 3 — Folha oficial

Formalizar regras de cálculo; criar revisão e fechamento mensal; adicionar justificativas e aprovações; impedir alterações posteriores sem reabertura autorizada; gerar PDF/A4 com versão, data, responsável e assinatura; e manter histórico de todas as versões.

### Fase 4 — Portal do colaborador

Criar autenticação individual; persistir solicitações de ausência, troca de dia e atualização cadastral; enviar confirmações; exibir calendário mensal; mostrar saldo e pendências; e permitir alteração de dados pessoais sem conceder acesso à batida de ponto.

## Critérios para considerar o sistema pronto

O sistema deve identificar individualmente cada gestor, registrar quem visualizou ou alterou cada informação sensível, impedir dados inválidos no servidor, nunca ocultar registros por limite silencioso, permitir reconstruir a história de uma marcação, ter fluxo de aprovação para alterações de jornada, fechar a folha com versão e responsável, proteger fotos com acesso temporário e manter funcionamento previsível quando a rede ou o serviço estiver indisponível.

## Conclusão

O painel já é utilizável como central de consulta e manutenção básica, mas ainda não deve ser tratado como sistema definitivo de controle de jornada sem implementar os itens P0. A evolução de maior impacto não é adicionar mais abas: é transformar dados e ações críticas em **fluxos auditáveis, aprováveis e reversíveis**. Depois desses fundamentos, indicadores, notificações e refinamentos visuais tornarão o painel mais rápido e poderoso para o gestor.

## Atualização de implementação — 26/08/2026

Foram aplicadas localmente as primeiras correções críticas sem tocar no banco de produção: o CRUD administrativo passou a reutilizar validação compartilhada para nome, matrícula, CPF, cargo, dias e jornada; a validação aceita também o formato JSON legado de dias; o CPF é normalizado antes do armazenamento; o PATCH consulta o colaborador existente e valida o estado completo antes de aceitar alterações; e o bootstrap administrativo deixou de executar DDL bruto e passou a exigir o token administrativo quando já existem gestores ativos.

### Evidência de teste

A suíte local terminou com **3 arquivos de teste, 11 testes aprovados**, TypeScript sem erros, `git diff --check` sem problemas e build Next.js de produção concluído. O preview local retornou HTTP 200 na rota `/colaborador` após o build limpo.

### Pendências não mascaradas

Ainda não foram implementados nesta etapa os modelos de solicitações, RBAC granular, MFA, rate limiting, auditoria imutável de usuários, fechamento oficial da folha, paginação acima de 1.000 registros, storage privado de fotos, backup testado, integração de notificações, arquivos AEJ/AFD e uma avaliação jurídica/homologação REP-P. Essas dependem de alterações planejadas, migrações não destrutivas, configuração de infraestrutura e, em alguns casos, validação externa.
