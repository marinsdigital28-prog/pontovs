import csv
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
type_map = {'VOLTA_ALMOCO': 'RETORNO', 'SAIDA_ALMOCO': 'INTERVALO'}
with source.open(encoding='utf-8-sig', newline='') as src, target.open('w', encoding='utf-8-sig', newline='') as dst:
    reader = csv.DictReader(src, delimiter=';')
    fields = reader.fieldnames or []
    writer = csv.DictWriter(dst, fieldnames=fields, delimiter=';')
    writer.writeheader()
    count = 0
    for row in reader:
        row['Tipo'] = type_map.get(row.get('Tipo', '').strip().upper(), row.get('Tipo', '').strip().upper())
        writer.writerow(row)
        count += 1
print(f'{count} linhas normalizadas em {target}')
