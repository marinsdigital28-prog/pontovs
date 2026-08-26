import json
from collections import Counter, defaultdict
from pathlib import Path

paths = [Path('/home/ubuntu/pontovs_repo/imports/punches-from-pdf.json'), Path('/home/ubuntu/upload/REGISTROS_PONTO_2026-08-26_PAGINA_1(1).csv')]
backup = json.loads(paths[0].read_text(encoding='utf-8'))
rows = backup['rows']
print('total', len(rows))
print('keys', sorted(rows[0].keys()) if rows else [])
print('types', Counter(str(row.get('type') or row.get('Tipo')) for row in rows))
by_employee_day = defaultdict(list)
for row in rows:
    employee = str(row.get('employeeNumber') or row.get('Matricula') or '').zfill(4)
    date = str(row.get('date') or row.get('Data') or '')
    by_employee_day[(employee, date)].append(row)
patterns = Counter()
examples = {}
for key, items in by_employee_day.items():
    types = tuple(sorted(str(item.get('type') or item.get('Tipo')) for item in items))
    patterns[types] += 1
    examples.setdefault(types, key)
print('day_patterns', patterns)
print('examples', examples)
print('sample_rows', rows[:5])
