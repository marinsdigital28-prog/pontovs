# Auditoria do backup de ponto — 26/08/2026

## Resultado da leitura

O PDF tem 35 páginas: uma página de resumo e 34 folhas individuais. O cabeçalho do backup declara **34 colaboradores ativos** e **1.414 marcações no mês**. A leitura dos cabeçalhos das folhas individuais encontrou **34 pessoas**, sendo **1 administrador genérico (matrícula 0000)** e **33 colaboradores com dados de folha**.

A extração determinística das linhas diárias das folhas individuais recuperou **1.244 marcações**, distribuídas entre os 33 colaboradores. Não foram encontrados números de matrícula desconhecidos dentro dessas linhas.

## Divergências que exigem confirmação

Há uma diferença de **170 marcações** entre o total declarado na capa (1.414) e as marcações recuperadas das linhas diárias das folhas individuais (1.244). A capa mostra somente as primeiras 21 marcações e não contém dados suficientes para reconstruir as 170 restantes com segurança.

O cadastro do sistema possui uma matrícula adicional, **0026 — CRISTIANO FERREIRA DA SILVA**, que não aparece entre as folhas individuais deste PDF. Não é seguro inventar cargo, jornada ou marcações para essa pessoa a partir de outro cadastro.

## Regra de segurança adotada

Nenhuma marcação foi gravada no banco enquanto essas duas divergências não forem esclarecidas. O arquivo `employees-from-pdf.json` contém os dados de identificação, cargo, departamento, escala e jornada extraídos das folhas. O arquivo `punches-from-pdf.json` contém as 1.244 marcações recuperadas, com sequência ENTRADA, INTERVALO, RETORNO e SAIDA quando aplicável.
