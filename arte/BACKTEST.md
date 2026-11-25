# Backtest — aprender com as correções do gestor

Gerado em 25/11/2026, 09:36:40 (Brasília).
Dataset: `tests/fixtures/classifier-backtest.json` (mesma origem de `/workspace/arte-painel-v2/backtest`, 01/10–23/11).
Lições extraídas: 42 correções de tipo + 100 lançamentos * (nunca se altera a batida original).

## Período inteiro (cada dia só vê correções anteriores)

| Métrica | Regra atual (sem lessons) | Com aprendizado |
|---|---|---|
| Tipos corrigidos pelo gestor | **41/42** (97.6%) | **41/42** (97.6%) |
| Lançamentos * no minuto exato | 68/100 (68.0%) | 68/100 (68.0%) |

Erros da regra atual:
- 2026-10-08 MNDD 12:01 totem INTERVALO → gestor SAIDA, sistema INTERVALO

Ainda errados com aprendizado:
- 2026-10-08 MNDD 12:01 totem INTERVALO → gestor SAIDA, sistema INTERVALO

## Walk-forward (aprende até D, testa depois de D)

| Corte D | Tipos depois de D (base → aprendido) | Lançamentos * (base → aprendido) | Resgatados | Perdidos |
|---|---|---|---|---|
| 2026-10-15 | 17/17 (100%) → **17/17 (100%)** | 43/59 → **43/59** | 0 | 0 |
| 2026-10-31 | 5/5 (100%) → **5/5 (100%)** | 19/22 → **19/22** | 0 | 0 |
| 2026-11-10 | 4/4 (100%) → **4/4 (100%)** | 17/19 → **17/19** | 0 | 0 |

## Como ler

A regra atual (90 dias, peso 3× nos 30 recentes, almoço fixo da escala, jornada flexível) já acerta 41/42 tipos. O aprendizado **não regride** esse gate, nem inventa Retorno ≥ 13:30 fora do padrão, nem sugere horário para o Cássio (jornada flexível), nem sobrepõe o almoço 10:30–11:30 do Robson.

As lições entram como sinal no hábito ponderado (completam dias com `*`, peso um pouco maior no dia corrigido, recorte por dia da semana só com evidência forte). Sem padrão claro (≥5 dias e ±20 min) a leitura continua DÚVIDA, sem horário inventado. Origem: fixture do classificador / `/workspace/arte-painel-v2/backtest`. Base: `1370c03` (`feat/classificador-padrao-real`).