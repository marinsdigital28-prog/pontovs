import csv
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

source = Path(sys.argv[1])
out = Path(sys.argv[2])
with source.open(encoding='utf-8-sig', newline='') as handle:
    rows = list(csv.DictReader(handle, delimiter=';'))

labels = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
by_employee = defaultdict(list)
for row in rows:
    when = datetime.strptime(f"{row['Data']} {row['Horario']}", '%Y-%m-%d %H:%M:%S')
    by_employee[row['Matricula'].strip()].append((when, row))

lines = ['# Auditoria de padrões de jornada', '', f'Arquivo: {source.name}', f'Marcações: {len(rows)}', f'Funcionários: {len(by_employee)}', '']
for employee, marks in sorted(by_employee.items()):
    by_date = defaultdict(list)
    for when, row in marks:
        by_date[when.date()].append((when, row))
    day_counts = Counter(labels[date.weekday()] for date in by_date)
    counts = ', '.join(f'{day}={day_counts[day]}' for day in labels if day_counts[day])
    durations = []
    first_times = []
    last_times = []
    type_sequences = Counter()
    for date, date_marks in sorted(by_date.items()):
        ordered = sorted(date_marks)
        first_times.append(ordered[0][0].strftime('%H:%M'))
        last_times.append(ordered[-1][0].strftime('%H:%M'))
        durations.append(round((ordered[-1][0] - ordered[0][0]).total_seconds() / 60))
        type_sequences[' > '.join(item[1]['Tipo'] for item in ordered)] += 1
    common_sequence, sequence_count = type_sequences.most_common(1)[0]
    name = marks[0][1]['Nome']
    lines.append(f'## {employee} — {name}')
    lines.append(f'- Dias observados: {counts}')
    lines.append(f'- Dias com marcação: {len(by_date)}; marcações: {len(marks)}')
    lines.append(f'- Primeiras entradas: {Counter(first_times).most_common(3)}')
    lines.append(f'- Últimas saídas: {Counter(last_times).most_common(3)}')
    lines.append(f'- Duração entre primeira e última marcação (min): mediana={sorted(durations)[len(durations)//2]}, mínimo={min(durations)}, máximo={max(durations)}')
    lines.append(f'- Sequência predominante: {common_sequence} ({sequence_count} dia(s))')
    lines.append('')
out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'Auditoria detalhada salva em {out}')
