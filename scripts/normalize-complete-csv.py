#!/usr/bin/env python3
import csv
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
with source.open(encoding='utf-8-sig', newline='') as src:
    rows = list(csv.reader(src, delimiter=';'))
header_index = next((i for i, row in enumerate(rows) if row and row[0].strip() == 'NSR'), None)
if header_index is None:
    raise SystemExit('cabeçalho NSR não encontrado')
header = rows[header_index]
index = {name.strip(): position for position, name in enumerate(header)}
required = ['NSR', 'Data', 'Horário', 'Matrícula', 'Colaborador', 'Departamento', 'Tipo de Marcação', 'Local / Unidade']
missing = [name for name in required if name not in index]
if missing:
    raise SystemExit(f'colunas ausentes: {missing}')

type_map = {'SAIDA_ALMOCO': 'INTERVALO', 'VOLTA_ALMOCO': 'RETORNO'}
with target.open('w', encoding='utf-8-sig', newline='') as dst:
    writer = csv.writer(dst, delimiter=';')
    writer.writerow(['NSR', 'Matricula', 'Nome', 'Departamento', 'Tipo', 'Data', 'Horario', 'Localizacao'])
    count = 0
    for row in rows[header_index + 1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        values = {name: row[position].strip() for name, position in index.items()}
        day, month, year = values['Data'].split('/')
        punch_type = type_map.get(values['Tipo de Marcação'].upper(), values['Tipo de Marcação'].upper())
        writer.writerow([
            values['NSR'],
            values['Matrícula'],
            values['Colaborador'],
            values['Departamento'],
            punch_type,
            f'{year}-{month}-{day}',
            values['Horário'],
            values['Local / Unidade'],
        ])
        count += 1
print(f'{count} linhas normalizadas em {target}')
