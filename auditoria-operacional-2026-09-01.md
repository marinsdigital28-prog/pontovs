# Auditoria Operacional — 01/09/2026

## Resumo executivo

Auditoria realizada sob as perspectivas de Contabilidade (Messa), Gestão (Dona Nilza), Assistência Administrativa (Renata) e Auditor Externo.

**Conclusão:** Sistema operacional sólido, sem falhas críticas de perda ou corrupção de marcações. Principais lacunas são de governança de fechamento mensal e visão consolidada de riscos.

## Melhorias aplicadas nesta etapa

1. **Central de Integridade** (nova aba no painel administrativo)
   - Agrega inconsistências abertas, solicitações pendentes, atestados em atenção, presença crítica do dia e últimas alterações administrativas.
   - Exibe KPIs de alertas e status do mês (Em aberto).
   - Aviso explícito de que nenhum arquivamento/limpeza ocorre sem fechamento + backup validado + confirmação.

2. Botão de acesso rápido à Central de Integridade na Visão Geral.

## O que NÃO foi alterado (regra absoluta)

- Aplicativo de marcação dos funcionários (`/ponto`)
- Fluxo de câmera, botão, offline, layout ou mensagens de status do colaborador
- Banco de dados (nenhuma migration destrutiva)
- Nenhuma limpeza automática

## Recomendação documentada (não implementada)

A tela de marcação ainda exibe mensagens que mencionam o tipo de batida (ex.: “Preparando a câmera para ENTRADA”).  
Isso pode confundir o funcionário.  
**Sugestão futura (somente com autorização explícita):** na etapa de câmera, mostrar apenas a câmera + botão “Marcar ponto”, sem indicar o tipo. A tipificação continua sendo feita pelo backend/admin.

## Próximos passos recomendados (aguardando autorização)

- Modelo e fluxo formal de Fechamento Mensal (status + bloqueio)
- Rotina de backup + arquivamento no Google Drive com validação de integridade
- Migração gradual das fotos para storage privado
- Usuários gestores individuais (em vez de senha global)

## Status final desta entrega

✅ Central de Integridade entregue e integrada ao painel administrativo.  
✅ Nenhuma alteração no app de marcação.  
✅ Sistema continua seguro para operação diária.
