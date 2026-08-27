# Execução dos prompts anexados

## Prompt 5 — publicação do Portal do Colaborador

A rota existente é `/colaborador` e o deployment principal do projeto é `https://ponto.marinsdistemas.xyz`. Não foi encontrado subdomínio dedicado de colaborador configurado. A rota abre como portal separado da tela `/ponto`, porém a implementação atual identifica o funcionário apenas por matrícula na URL e a API `/api/employee/history` não exige sessão autenticada. Portanto, o portal não pode ser declarado como pronto para uso real antes de corrigir o vínculo seguro usuário-funcionário.

Critérios de segurança: o portal deve autenticar o colaborador, resolver o funcionário no servidor pela sessão, nunca confiar em `employeeNumber` enviado pelo navegador e bloquear acesso a dados de terceiros, batidas, folha administrativa e rotas de gestor. Solicitações de ausência, troca e perfil não podem permanecer como mensagens locais de teste; precisam de persistência oficial ou devem ser explicitamente marcadas como indisponíveis.

## Prompt 6 — lançamentos de atestados

O schema PostgreSQL atual possui `User`, `Punch`, `PunchAudit`, `Inconsistency` e `UnitSettings`, mas não possui entidade `Absence`/`MedicalCertificate`. Também não foram localizadas rotas ou telas administrativas de atestados. A implementação necessária é uma camada de justificativa associada ao usuário, com período, dias de trabalho abrangidos, documento protegido, observação, status e auditoria. O atestado não pode criar batida falsa, apagar marcações ou substituir o histórico.

Critérios funcionais: criar, listar, consultar, editar e cancelar logicamente; impedir sobreposição silenciosa; aceitar PDF/JPG/JPEG/PNG com limite de tamanho; registrar autor, datas e alterações; mostrar `ATESTADO` na folha quando não houver batida e `ATESTADO + MARCAÇÃO EXISTENTE` quando houver registro preservado; excluir a data da contagem de falta e manter o cálculo de horas previstas baseado na escala.

## Ordem segura de execução

1. Criar modelos e migration do atestado no schema PostgreSQL sem executar comandos destrutivos.
2. Criar APIs administrativas autenticadas para CRUD, documento e cancelamento lógico.
3. Integrar atestado à construção das linhas da folha e aos totais.
4. Criar painel administrativo de atestados com filtros, estados e ações.
5. Corrigir o portal para autenticação e consulta somente dos próprios dados; não publicar o portal atual como se fosse seguro.
6. Testar regras de período, escala, sobreposição, documento, auditoria e isolamento de acesso.
7. Publicar somente após build, testes e validação das variáveis de produção.

## Decisões de preservação

Não alterar a tela de batida, não apagar marcações, não criar banco paralelo, não remover a assinatura A1, não expor documentos por URL pública e não afirmar que o portal está pronto enquanto a autenticação vinculada ao funcionário não estiver implantada.
