# TODO do sistema web

- [x] Corrigir e validar o painel administrativo no domínio principal
- [x] Investigar link `/admin` indisponível após o último redeploy
- [x] Confirmar autenticação e carregamento do painel em produção
- [x] Validar que `/ponto` permanece funcionando

- [x] Alterar o login administrativo para aceitar somente senha global
- [x] Validar acesso ao `/admin` sem campo de e-mail no domínio de produção
- [x] Sincronizar o commit de autenticação por senha com o repositório remoto
- [x] Confirmar o deploy da nova tela administrativa no domínio
- [ ] Após registrar, retornar automaticamente à matrícula vazia para o próximo colaborador
- [ ] Ao reconhecer a matrícula, abrir automaticamente câmera grande e seleção do tipo de batida
- [ ] Reorganizar o `/ponto` para exibir todas as etapas principais em uma única tela sem rolagem
- [x] Confirmar a marcação automaticamente ao capturar a foto, sem segundo botão
- [x] Exibir a foto capturada ocupando quase toda a tela com confirmação destacada
- [x] Fazer a segunda tela de registro caber inteira na viewport, sem rolagem vertical
- [x] Criar dashboard administrativo completo com indicadores e visão operacional
- [x] Criar gestão de colaboradores com cadastro, edição, ativação e matrícula
- [x] Criar gestão de turnos, jornada e dias trabalhados
- [x] Aprimorar gestão de registros de ponto com filtros, detalhes e fotos
- [x] Criar área de inconsistências, auditoria e ações administrativas
- [x] Validar segurança, responsividade, banco e publicar a área administrativa completa
- [x] Simplificar a segunda etapa para exibir somente câmera e botão único “Marcar + Foto”
- [x] Mostrar confirmação imediata na mesma tela após captura e envio
- [x] Remover blocos extras e manter o fluxo rápido sem rolagem
- [x] Diagnosticar por que o `/ponto` mostra “Sem conexão” e fica sem a etapa da câmera
- [x] Corrigir o tratamento de erros para diferenciar offline, câmera e falha da API
- [x] Validar o fluxo de matrícula, câmera, registro e confirmação após a correção
- [ ] Criar gestão administrativa completa de usuários, perfis e status de acesso
- [ ] Criar relatórios de marcações, jornada, faltas e inconsistências
- [ ] Adicionar filtros por período, colaborador, setor e tipo de batida
- [ ] Adicionar exportação de relatórios em CSV
- [ ] Validar permissões, consultas, responsividade e publicação
- [x] Corrigir travamento após captura quando a marcação não é salva
- [x] Garantir persistência da foto e da batida no PostgreSQL
- [x] Confirmar que a batida salva aparece no `/admin`
- [x] Diagnosticar a falha atual de não registro no `/ponto`
- [x] Garantir persistência idempotente da batida e da foto no PostgreSQL
- [x] Confirmar sucesso somente após o banco responder com o registro criado
- [x] Validar que o registro aparece no `/admin` e publicar a correção
- [ ] Publicar na Vercel o commit 4d3c627 da correção definitiva do salvamento
- [x] Revisar a tela de relatórios administrativos e sua consulta de registros
- [x] Validar filtros de período, colaborador e tipo de batida
- [x] Confirmar exibição correta de horário, status, origem e foto
- [ ] Corrigir divergências e publicar a revisão dos relatórios
- [x] Exibir mensagem clara quando todas as batidas do dia já estiverem concluídas
- [x] Impedir abertura da câmera em jornada encerrada e retornar à matrícula após feedback
- [x] Criar folha de ponto no `/admin` com layout equivalente ao PDF de referência
- [x] Integrar totalizadores e registros reais do PostgreSQL
- [x] Atualizar a folha automaticamente após novas batidas
- [x] Adicionar visualização para impressão e filtros por competência
- [x] Corrigir a publicação da aba Folha de ponto no painel administrativo do domínio
- [x] Validar a aba Folha de ponto diretamente em produção
- [x] Tornar a aba Folha de ponto visível no menu móvel sem rolagem horizontal escondida
- [x] Validar o acesso móvel direto à Folha de ponto sem regressões
- [x] Configurar verificação automática diária do painel e do deploy da Folha de ponto
- [x] Corrigir o aviso “Filtro inválido” exibido ao abrir a Folha de ponto em produção
- [x] Validar que a folha carrega os registros reais após a correção
- [x] Transformar a Folha de ponto em folha individual por colaborador conforme o modelo enviado
- [x] Criar calendário diário com horários, horas trabalhadas, horas previstas, saldo, faltas, atrasos e justificativas
- [x] Permitir impressão de uma folha por colaborador e impressão em lote
- [x] Validar atualização automática e cálculos da folha individual
- [x] Auditar as folhas individuais de todos os 34 colaboradores em produção
- [x] Conferir carregamento de calendário, registros e totais para cada matrícula
- [x] Remover o bloco Último registro da tela `/ponto`
- [x] Remover os botões inferiores da tela `/ponto`
- [x] Ampliar o teclado numérico usando o espaço liberado
- [x] Validar o fluxo de marcação após simplificar a tela
- [ ] Aumentar um pouco o relógio na tela `/ponto`
- [ ] Aumentar os números do teclado e preencher melhor a altura da tela
- [ ] Validar que a tela continua sem rolagem no celular
- [ ] Aumentar novamente o relógio da tela `/ponto` sem cortar o teclado
- [ ] Redistribuir o layout vertical para preencher toda a tela do relógio de ponto
- [ ] Confirmar que teclado, matrícula e botão permanecem visíveis sem rolagem
- [x] Ampliar o quadrado da foto na etapa de câmera do `/ponto`
- [x] Confirmar que o botão Marcar + Foto e a confirmação continuam visíveis

- [x] Validar animação de confirmação com bola verde, check e texto “MARCAÇÃO CONFIRMADA”
- [x] Validar proteção da fila offline e reenvio automático sem perda de pendências
- [x] Publicar o commit 9d058ee no repositório remoto

- [ ] Extrair e auditar as marcações e dados do PDF Backup_Ponto_2026-08-26
- [ ] Cruzar as matrículas e nomes do PDF com os 34 colaboradores existentes
- [ ] Importar as marcações históricas sem duplicidades e com validação
- [ ] Completar os cargos de todos os colaboradores a partir dos dados confirmados
- [ ] Ajustar a Folha de Ponto para ocupar a página A4 inteira mantendo o modelo fornecido
- [ ] Validar dados importados, folha individual e impressão A4

- [ ] Importar imediatamente todas as marcações comprovadas do backup enviado
- [ ] Validar no `/admin` a quantidade de colaboradores e marcações após a importação

- [ ] Concluir o deployment do importador no projeto Vercel do domínio público
- [ ] Importar as marcações comprovadas e validar a persistência sem duplicidades
- [ ] Definir acesso individual seguro para cada colaborador
- [ ] Criar portal do colaborador com confirmações de ponto e calendário mensal
- [ ] Permitir solicitações de ausência e troca de dia com fluxo para aprovação administrativa
- [ ] Permitir completar e editar dados de perfil com auditoria
- [ ] Exibir dias trabalhados, faltas, saldo e progresso de fechamento mensal
- [ ] Testar a integração entre portal do colaborador, `/ponto` e `/admin`

- [ ] Preencher cargo, dias trabalhados e horários de jornada de cada funcionário a partir do backup
- [ ] Conferir que os dados de jornada foram vinculados à matrícula correta

- [ ] Diagnosticar o bloqueio de deployment da Vercel e identificar se é limite, configuração ou build
- [ ] Validar o vínculo do projeto `pontovs` com o GitHub e o domínio público
- [ ] Publicar o commit mais recente por um caminho autorizado e seguro
- [ ] Confirmar as rotas `/ponto`, `/admin` e `/colaborador` após a publicação

- [x] Implementar localmente o dashboard do colaborador com consulta, histórico e visão mensal
- [x] Implementar localmente formulários de ausência, troca de dia e atualização de perfil
- [x] Validar estados de segurança, confirmação e erros da interface do colaborador
- [x] Executar testes e build local para liberar a URL de teste

- [x] Remover o botão e o link de registrar ponto do portal do colaborador
- [x] Criar área “Minhas informações” com CPF, cargo, unidade, dias e horários
- [x] Adicionar e-mail, WhatsApp e data de nascimento ao formulário local
- [x] Validar campos obrigatórios e impedir alterações indevidas de jornada sem aprovação
- [x] Testar o portal local sem qualquer atalho para bater ponto pelo telefone

- [ ] Corrigir preview local que abre sem o layout do portal do colaborador
- [ ] Confirmar carregamento do CSS e dos assets no endereço exposto

- [ ] Destacar visualmente o campo de matrícula no portal do colaborador
- [ ] Garantir validação da matrícula antes de exibir os dados pessoais

- [x] Implementar validação matemática e normalização de CPF
- [x] Implementar validação e normalização de e-mail, WhatsApp e data de nascimento
- [x] Implementar validação de matrícula, unidade, dias e horários
- [x] Impedir que alterações de cargo e jornada entrem em vigor sem aprovação
- [ ] Testar as validações no formulário e na API local

- [ ] Diagnosticar por que o layout do portal desaparece novamente no preview
- [ ] Estabilizar a execução local e o carregamento dos arquivos CSS
- [ ] Confirmar o layout após recarregar e reiniciar o preview

- [x] Reproduzir as opções do portal que não estão funcionando
- [x] Corrigir os eventos de clique, identificação e envio dos formulários
- [x] Testar resumo, ausência, troca de dia e Minhas informações no preview

- [x] Auditar telas, rotas, APIs e banco usados pelo painel administrativo
- [x] Auditar segurança, permissões, auditoria e confiabilidade operacional
- [x] Auditar folha de ponto, relatórios, filtros e experiência do gestor
- [x] Testar o painel local e consolidar lacunas por prioridade
- [x] Entregar diagnóstico executivo do que falta para o sistema operar em nível profissional

- [ ] Converter a missão master anexada em matriz de requisitos e riscos verificáveis
- [ ] Auditar OWASP, autenticação, autorização, IDOR/BOLA, integridade e observabilidade
- [ ] Auditar LGPD, dados sensíveis, uploads, retenção e exposição de informações
- [ ] Preservar dados e funcionalidades existentes durante todas as correções
- [ ] Documentar correções aplicadas, testes, riscos residuais e plano de produção

- [x] Implementar rate limiting para login, marcações, consultas, importações e exportações
- [x] Criar auditoria imutável e encadeada para ações administrativas e eventos críticos
- [x] Adicionar testes de concorrência, limite, integridade e autorização
- [x] Atualizar o painel administrativo com status de segurança e atividade auditada
- [x] Atualizar a área do funcionário com feedback de segurança e histórico de solicitações
- [x] Gerar e validar preview web das rotas `/admin` e `/colaborador`

- [ ] Adicionar modelo `SecurityAuditEvent` append-only ao Prisma
- [ ] Criar migration não destrutiva para a tabela de auditoria
- [ ] Persistir eventos com encadeamento de hashes e verificar a cadeia
- [ ] Integrar rate limiting distribuído usando Redis com fallback somente local
- [ ] Adicionar variáveis de ambiente documentadas sem expor segredos
- [ ] Testar concorrência, indisponibilidade do Redis e integridade da auditoria
- [ ] Validar build e preparar instruções de configuração em produção

- [x] Adicionar edição controlada de marcação com motivo obrigatório
- [x] Adicionar ação “Excluir” como cancelamento lógico, sem apagar o original
- [x] Registrar tratamento em auditoria com autor, motivo e valores anterior/novo
- [x] Adicionar confirmação visual e proteção contra ações irreversíveis no painel
- [x] Testar permissões, validação e regressões do painel administrativo

- [x] Criar monitor de presença na Visão geral com círculo, foto, nome e status
- [x] Exibir rapidamente quem está presente, não marcou e está ausente ou pendente
- [x] Adicionar filtro/ordenação rápida por status de presença
- [x] Testar o painel visual em desktop e mobile
- [x] Verificar build, GitHub, variáveis e limite da Vercel antes do deploy

- [x] Auditar o CSV de registros enviado em 26/08/2026
- [ ] Comparar matrículas e marcações do CSV com a base local e produção
- [ ] Confirmar importação idempotente sem duplicidades e documentar o resultado

- [ ] Importar as marcações do CSV enviado no ambiente de produção
- [ ] Confirmar inserções, existentes e rejeitadas após a importação
- [ ] Conferir as marcações importadas na Visão geral e nos registros administrativos

- [x] Renomear “Horários” para “Escala” na Folha de Ponto
- [x] Manter “Marcações” como horários efetivamente registrados
- [x] Validar que escala prevista e batidas reais permanecem separadas

- [x] Auditar padrões de entrada, almoço, retorno e saída no CSV enviado
- [x] Aplicar 1 hora de almoço para jornadas integrais
- [x] Diferenciar jornadas de meio expediente sem desconto de almoço indevido
- [x] Validar os cálculos da Folha de Ponto com os padrões importados

- [x] Criar botão Importar CSV dentro do painel administrativo
- [x] Exibir prévia e validar colunas, matrículas, datas, horários e tipos
- [x] Conectar confirmação do usuário ao importador idempotente
- [x] Exibir resultado detalhado com criados, já existentes e ignorados
- [x] Testar segurança, duplicidade, erros e build de produção

- [ ] Extrair e auditar o PDF Backup_Ponto_2026-08-26(1)
- [ ] Preparar colaboradores e marcações do PDF para importação idempotente
- [ ] Executar a importação protegida em produção
- [ ] Confirmar criados, existentes, ignorados e persistência no painel

- [ ] Substituir a credencial administrativa de produção sem tentar recuperar a senha antiga
- [ ] Validar a nova credencial no endpoint protegido
- [ ] Retomar a importação idempotente do PDF após a validação

- [ ] Verificar acesso autenticado ao Vercel nesta sessão
- [ ] Conferir deployment, domínio e presença da variável administrativa sem revelar valores
- [ ] Diagnosticar a recusa 401 da importação em produção

- [ ] Corrigir o comando de build do projeto Vercel correto
- [ ] Confirmar que o domínio serve o commit com importação CSV/PDF
- [ ] Validar a credencial administrativa de produção
- [ ] Importar as marcações somente após a produção estar autorizada

- [x] Confirmar ambiente de teste e próximo tipo da matrícula 4041
- [x] Executar uma batida de teste com foto identificada como simulação
- [x] Conferir confirmação, persistência e exibição no painel administrativo
- [x] Documentar o registro criado e qualquer necessidade de estorno administrativo

- [x] Comparar visualmente a referência e o `/ponto` público
- [x] Confirmar se o deployment publicado contém o layout do totem
- [x] Documentar diferenças restantes de marcação e confirmação

- [x] Fazer a etapa de matrícula e teclado caber na tela móvel sem rolagem
- [x] Fazer câmera e confirmação caberem na tela móvel sem rolagem
- [x] Validar alturas pequenas, celulares estreitos e build de produção

- [ ] Diagnosticar o corte persistente no viewport móvel
- [ ] Remover alturas fixas e conflitos de overflow no fluxo de marcação
- [ ] Validar matrícula, câmera e confirmação em telas baixas

- [ ] Auditar o PDF atualizado Backup_Ponto_2026-08-26(2)
- [ ] Comparar o lote atualizado com as marcações já preparadas
- [ ] Importar todas as marcações válidas sem duplicidades
- [ ] Confirmar a folha atualizada no painel antes do uso nos dispositivos

- [x] Autorizar importações pela sessão autenticada do gestor
- [ ] Criar fluxo de importação de PDF dentro do painel
- [x] Manter token técnico apenas como fallback seguro para automações
- [x] Testar importação sem solicitar senha no chat

- [ ] Validar build e diff da correção de autenticação por sessão
- [ ] Publicar a correção no projeto Vercel `pontovs`
- [ ] Confirmar deployment pronto antes da atualização das marcações
- [ ] Atualizar o backup idempotentemente após a publicação

- [ ] Publicar a autorização por sessão no projeto Vercel correto
- [ ] Validar a sessão de gestor no domínio
- [ ] Importar as 1.414 marcações do PDF atualizado
- [ ] Conferir a folha e a visão geral após a carga

- [x] Criar botão Importar PDF no painel administrativo
- [x] Ler todas as páginas do PDF no backend
- [x] Mostrar prévia completa por colaborador e batida
- [x] Confirmar importação idempotente pela sessão do gestor
- [x] Testar PDF completo e build de produção

- [x] Confirmar se o commit 13c5397 está no deployment do projeto `pontovs`
- [ ] Corrigir a publicação caso o domínio esteja em versão anterior
- [ ] Confirmar visualmente o cartão Importar PDF no `/admin`

- [ ] Preparar árvore de publicação sem PDFs, backups ou segredos
- [ ] Fazer deployment manual de produção no projeto `pontovs`
- [ ] Confirmar estado READY e cartão Importar PDF no domínio

- [x] Auditar o CSV PONTOS_ESP_PROGREDIR_2026_08
- [x] Identificar incompatibilidades de separador, cabeçalho, codificação ou formato
- [x] Gerar arquivo compatível ou ajustar o parser sem duplicidades
- [x] Validar o lote na prévia do importador
- [x] Aplicar no painel os dias e horários inferidos do CSV mensal
- [x] Corrigir Folha de Ponto que exibe dias da escala como folga
- [x] Adicionar assinatura digital do Espaço Progredir à Folha de Ponto
- [x] Configurar certificado A1 para assinatura criptográfica das folhas PDF
- [x] Remover marca d’água e aumentar fonte da Folha de Ponto
- [x] Auditar e preparar o CSV completo de marcações de agosto sem duplicidades
- [ ] Importar o CSV completo de marcações de agosto no ambiente autorizado
- [x] Atualizar logo do aplicativo para ícone circular com borda amarelo-dourada
- [x] Refletir alterações de cargo, dias e horários imediatamente na Folha de Ponto
- [x] Criar lançamento manual de marcação esquecida com motivo e auditoria
- [x] Reorganizar a primeira aba da Administração em uma central operacional clara
- [x] Adicionar gráficos reais de presença e pontualidade da equipe
- [x] Aplicar automaticamente escala, cargo e horas previstas a partir do padrão de marcações
- [x] Permitir a próxima marcação válida sem bloquear com mensagem de marcação existente

- [x] Fixar as quatro escalas oficiais: 07:00–16:00, 07:30–16:30, 08:00–17:00 e 12:00–16:00
- [x] Corrigir a inferência para não gerar horários quebrados e refletir escala/horas previstas na folha
- [x] Ajustar folha A4 horizontal para uma única página com tipografia legível
- [x] Exibir totais no rodapé da folha de ponto
- [x] Posicionar assinatura digital A1 no canto inferior esquerdo e assinatura do colaborador no canto inferior direito
- [x] Garantir que PDF oficial assinado não seja gerado sem certificado A1 válido
- [x] Testar visualmente e por código a geração, paginação e assinatura digital
- [x] Publicar a correção em produção após validação

- [ ] Configurar o certificado A1 fornecido no ambiente seguro de produção sem expor o conteúdo
- [ ] Validar senha, validade e leitura do arquivo PFX
- [ ] Gerar uma folha de ponto assinada e verificar a assinatura criptográfica
- [ ] Confirmar a exportação assinada no domínio de produção

- [x] Configurar o certificado A1 fornecido no ambiente Production da Vercel
- [x] Atualizar a senha A1 como variável secreta protegida
- [x] Redeployar Production com as novas credenciais
- [x] Gerar PDF de teste A4 com assinatura PKCS#7 e validar todos os bytes assinados
- [x] Confirmar o emissor do certificado: ESPACO PROGREDIR:05553848000161
- [x] Confirmar assinatura SHA-256 válida; a confiança da cadeia depende das autoridades certificadoras instaladas no visualizador

> O arquivo PFX não foi commitado nem armazenado no repositório. As credenciais permanecem write-only na Vercel.

- [x] Criar visão mensal com todas as folhas de ponto dos colaboradores
- [x] Criar impressão/exportação em lote, uma folha A4 horizontal por colaborador, em sequência
- [x] Usar a assinatura institucional oficial do Espaço Progredir em todas as folhas assinadas
- [x] Revisar e melhorar a visão geral do painel administrativo
- [x] Melhorar navegação, filtros, estados vazios, feedbacks e ações administrativas
- [x] Validar lote mensal, paginação A4, assinatura A1 e responsividade
- [x] Publicar as melhorias após os testes

- [x] Corrigir a exibição de horas previstas por dia e o total mensal de horas previstas
- [x] Manter o certificado institucional visual igual ao modelo de referência, com bloco verde e identificação A1
- [x] Validar o cálculo de jornada integral, almoço de 1 hora e meio expediente
- [x] Testar a folha completa e publicar a correção

- [x] Ler e decompor o Prompt de Atestados anexado
- [x] Ler e decompor o Prompt de Redesign do Painel Administrativo anexado
- [x] Auditar a arquitetura atual antes de aplicar os prompts
- [x] Implementar atestados com período, documento, status, cancelamento lógico e auditoria
- [x] Integrar atestados à folha sem criar batidas artificiais
- [ ] Aplicar melhorias executáveis do redesign do painel administrativo
- [x] Testar permissões, privacidade, não duplicação e regressões
- [x] Publicar a execução validada dos dois prompts

- [x] Criar solicitação persistente de ausência pelo portal do colaborador
- [x] Criar solicitação persistente de troca de dia pelo portal do colaborador
- [x] Criar aprovação e rejeição pelo gestor com auditoria
- [x] Refletir solicitações aprovadas na folha sem apagar marcações originais
- [x] Garantir uma página A4 horizontal por colaborador na impressão em lote
- [x] Validar totais mensais de horas previstas e realizadas
- [x] Testar permissões, cálculos, impressão e publicar

- [x] Adicionar campo de matrícula no login do Portal do Colaborador
- [x] Autenticar matrícula com senha sem expor dados por URL
- [x] Testar login por matrícula, sessão e privacidade
- [x] Publicar a correção do login do portal

- [x] Deixar o login do portal somente com matrícula e senha
- [x] Configurar jornadas por dia para Eduardo: seg/sex integral e quarta 12:00–16:00
- [x] Configurar jornadas por dia para Gilvan: terça/quarta integral e quinta 12:00–16:00
- [x] Garantir somente entrada e saída no meio expediente
- [x] Corrigir a visibilidade e o lançamento de atestados no painel
- [x] Testar folha, login e publicação
