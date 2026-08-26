import csv
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

source = Path(sys.argv[1])
out_json = Path(sys.argv[2])
out_csv = Path(sys.argv[3])

with source.open(encoding='utf-8-sig', newline='') as handle:
    rows = list(csv.DictReader(handle, delimiter=';'))

weekday_labels = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
by_employee = defaultdict(list)
for row in rows:
    try:
        when = datetime.strptime(f"{row['Data']} {row['Horario']}", '%Y-%m-%d %H:%M:%S')
    except (KeyError, ValueError):
        continue
    employee = row.get('Matricula', '').strip()
    if not employee:
        continue
    item = {**row, 'when': when}
    by_employee[employee].append(item)

summaries = []
for employee, marks in sorted(by_employee.items()):
    by_date = defaultdict(list)
    for mark in marks:
        by_date[mark['Data']].append(mark)
    first = marks[0]
    names = [m.get('Nome', '').strip() for m in marks if m.get('Nome', '').strip()]
    departments = [m.get('Departamento', '').strip() for m in marks if m.get('Departamento', '').strip()]
    weekday_dates = defaultdict(set)
    daily = []
    for date, date_marks in sorted(by_date.items()):
        ordered = sorted(date_marks, key=lambda m: m['when'])
        weekday = ordered[0]['when'].weekday()
        weekday_dates[weekday].add(date)
        daily.append((date, ordered))

    observed_days = [weekday_labels[i] for i in sorted(weekday_dates)]
    first_times = []
    last_times = []
    break_minutes = []
    work_minutes = []
    for _, ordered in daily:
        if len(ordered) >= 2:
            first_times.append(ordered[0]['when'].hour * 60 + ordered[0]['when'].minute)
            last_times.append(ordered[-1]['when'].hour * 60 + ordered[-1]['when'].minute)
        if len(ordered) >= 4:
            break_minutes.append((ordered[2]['when'] - ordered[1]['when']).total_seconds() / 60)
            work_minutes.append((ordered[-1]['when'] - ordered[0]['when']).total_seconds() / 60)
        elif len(ordered) == 2:
            work_minutes.append((ordered[-1]['when'] - ordered[0]['when']).total_seconds() / 60)

    def fmt_minutes(value):
        if value is None:
            return ''
        value = int(round(value))
        return f'{value // 60:02d}:{value % 60:02d}'

    median_first = statistics.median(first_times) if first_times else None
    median_last = statistics.median(last_times) if last_times else None
    median_break = statistics.median(break_minutes) if break_minutes else None
    median_work = statistics.median(work_minutes) if work_minutes else None
    full_shift = bool(median_work is not None and median_work > 360) or bool(median_break is not None and median_break >= 30)
    summary = {
        'employeeNumber': employee,
        'name': max(set(names), key=names.count) if names else first.get('Nome', '').strip(),
        'department': max(set(departments), key=departments.count) if departments else first.get('Departamento', '').strip(),
        'observedDates': len(by_date),
        'totalPunches': len(marks),
        'workDays': ','.join(observed_days),
        'firstEntryMedian': fmt_minutes(median_first),
        'lastExitMedian': fmt_minutes(median_last),
        'breakMedianMinutes': '' if median_break is None else int(round(median_break)),
        'workDurationMedianMinutes': '' if median_work is None else int(round(median_work)),
        'regime': 'INTEGRAL' if full_shift else 'MEIO_EXPEDIENTE',
        'confidence': 'ALTA' if len(by_date) >= 5 and len(first_times) >= 5 else ('MEDIA' if len(by_date) >= 2 else 'BAIXA'),
    }
    summaries.append(summary)

out_json.write_text(json.dumps({'source': str(source), 'rows': len(rows), 'employees': summaries}, ensure_ascii=False, indent=2), encoding='utf-8')
with out_csv.open('w', encoding='utf-8-sig', newline='') as handle:
    fields = list(summaries[0].keys()) if summaries else []
    writer = csv.DictWriter(handle, fieldnames=fields, delimiter=';')
    writer.writeheader()
    writer.writerows(summaries)
print(f'{len(rows)} marcações analisadas; {len(summaries)} funcionários encontrados')
