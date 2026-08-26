# Auditoria das folhas individuais — 26/08/2026

A auditoria foi executada diretamente no domínio de produção `https://ponto.marinsdistemas.xyz/admin`, na aba `Folha de ponto`, usando as 34 opções reais do cadastro de colaboradores.

## Resultado consolidado

- Colaboradores testados: 34
- Folhas renderizadas: 34
- Calendários diários renderizados: 34
- Assinatura e totais presentes: 34
- Erros de consulta ou renderização encontrados: 0
- Registros de teste inseridos: 0
- Alterações no banco: 0

## Critérios verificados em cada matrícula

Cada seleção foi feita no campo de colaborador e aguardou o carregamento da folha. Foram confirmados: título `RELATÓRIO DE PONTO DO COLABORADOR`, calendário diário, colunas de horas trabalhadas e previstas, assinatura do colaborador, atualização do documento e ausência dos textos de erro `Erro ao`, `Falha ao`, `Filtro inválido` e `não foi possível`.

## Observação de dados

A folha respeita a escala cadastrada. Quando o colaborador não possui escala/jornada cadastrada, os campos de previsão e saldo aparecem como `—`, e não são geradas faltas ou saldo negativo artificialmente.

## Conclusão

As 34 folhas individuais carregam corretamente em produção. A rotina automática de atualização permanece disponível a cada 10 segundos, e a impressão individual está disponível no botão `Imprimir folha`.
