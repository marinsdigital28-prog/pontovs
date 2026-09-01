# Auditoria do modelo PontoProgredir

O PDF enviado tem 67 páginas e usa uma folha A4 horizontal independente por funcionário. O cabeçalho contém instituição, endereço, CNPJ, período/competência, nome, CPF, matrícula, cargo, departamento, unidade, escala e jornada. A tabela diária usa as colunas Data, Horários (escala), Marcações, H.Trab, H.Just, H.Prev, H.Falt, H.Exc, Saldo, Desc. e Justificativa. O rodapé apresenta totais de horas positivas e negativas, total trabalhado, total previsto, saldo, faltas e atrasos. O certificado digital A1 aparece no rodapé junto da assinatura institucional e da assinatura do colaborador.

O gerador atual `lib/signed-timesheet-pdf.ts` já cria uma página A4 horizontal por chamada/funcionário, incorpora certificado PKCS#7/CMS com A1 e mostra bloco de certificado no rodapé. Ele ainda usa menos colunas que o modelo: H.Trab, H.Prev, Saldo, Desc. e Justificativa. O cabeçalho não consulta a relação `unit` e não inclui departamento/unidade. A rotina de atestado já soma `hoursPerDayMinutes` ao total trabalhado, mas não separa visualmente H.Just e H.Falt/H.Exc. A próxima implementação deve aproximar essas colunas e totais do modelo sem remover o certificado nem alterar a assinatura.

A entidade User possui `jobTitle`, `workDays`, `scheduleStart`, `scheduleEnd` e relação opcional `unit` (`Unit.name`).

A comparação visual confirmou que a composição está no caminho correto, mas a prévia atual apresentava sobreposição entre as últimas linhas da tabela e os totais do rodapé. O espaço reservado ao rodapé precisa ser ampliado antes da entrega para manter as 31 linhas, totais e assinaturas separados, como no modelo real.

A prévia gerada sobre a base mais recente do GitHub ainda mostrou sobreposição entre os totais e as últimas linhas da tabela. A correção deve aumentar `footerReserve` no gerador atual, que também suporta o PDF em lote, antes de qualquer publicação final.
