#!/usr/bin/env python3
import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
text = raw.decode("utf-8-sig")
rows = list(csv.reader(text.splitlines(), delimiter=";"))
header_index = next((i for i, row in enumerate(rows) if row and row[0].strip() == "NSR"), None)
if header_index is None:
    raise SystemExit("cabeçalho NSR não encontrado")
header = rows[header_index]
data_rows = [row for row in rows[header_index + 1:] if any(cell.strip() for cell in row)]
records = [dict(zip(header, row)) for row in data_rows if len(row) == len(header)]
short_rows = [row for row in data_rows if len(row) != len(header)]

def parse_dt(record):
    return datetime.strptime(f"{record['Data']} {record['Horário']}", "%d/%m/%Y %H:%M:%S")

def normalized_type(value):
    return {"SAIDA_ALMOCO": "INTERVALO", "VOLTA_ALMOCO": "RETORNO"}.get(value.strip().upper(), value.strip().upper())

def norm_cell(value):
    return value.strip().replace("\ufeff", "")

nsr_counts = Counter(norm_cell(r.get("NSR", "")) for r in records)
identity_counts = Counter(
    (norm_cell(r.get("Matrícula", "")), norm_cell(r.get("Data", "")), norm_cell(r.get("Horário", "")), normalized_type(r.get("Tipo de Marcação", "")))
    for r in records
)
by_employee = defaultdict(list)
for r in records:
    by_employee[norm_cell(r["Matrícula"])].append(r)

valid_status = Counter(norm_cell(r.get("Status", "")) for r in records)
types = Counter(normalized_type(r.get("Tipo de Marcação", "")) for r in records)
raw_types = Counter(norm_cell(r.get("Tipo de Marcação", "")) for r in records)
dates = sorted(parse_dt(r).date().isoformat() for r in records)
invalid = []
for i, r in enumerate(records, start=header_index + 2):
    required = ["NSR", "Data", "Horário", "Matrícula", "Colaborador", "Tipo de Marcação", "Status"]
    missing = [field for field in required if not norm_cell(r.get(field, ""))]
    try:
        parsed = parse_dt(r)
    except Exception as exc:
        parsed = None
        missing.append(f"data/hora inválida: {exc}")
    if not norm_cell(r.get("Matrícula", "")).isdigit():
        missing.append("matrícula não numérica")
    if normalized_type(r.get("Tipo de Marcação", "")) not in {"ENTRADA", "INTERVALO", "RETORNO", "SAIDA"}:
        missing.append("tipo não suportado")
    if missing:
        invalid.append({"line": i, "nsr": r.get("NSR", ""), "errors": missing})

employee_summary = []
weekday_names = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
for employee_number, employee_records in sorted(by_employee.items(), key=lambda item: item[0]):
    parsed_dates = sorted({parse_dt(r).date() for r in employee_records})
    weekdays = Counter(weekday_names[d.weekday()] for d in parsed_dates)
    employee_summary.append({
        "matricula": employee_number,
        "nome": norm_cell(employee_records[0].get("Colaborador", "")),
        "cargo": norm_cell(employee_records[0].get("Cargo", "")),
        "registros": len(employee_records),
        "dias_com_marcacao": len(parsed_dates),
        "primeiro_dia": parsed_dates[0].isoformat() if parsed_dates else None,
        "ultimo_dia": parsed_dates[-1].isoformat() if parsed_dates else None,
        "dias_semana": dict(sorted(weekdays.items())),
        "tipos": dict(sorted(Counter(normalized_type(r.get("Tipo de Marcação", "")) for r in employee_records).items())),
    })

output = {
    "arquivo": path.name,
    "sha256": hashlib.sha256(raw).hexdigest(),
    "bytes": len(raw),
    "linhas_total_arquivo": len(rows),
    "linha_cabecalho": header_index + 1,
    "registros": len(records),
    "linhas_com_largura_invalida": len(short_rows),
    "matriculas": len(by_employee),
    "matriculas_lista": sorted(by_employee),
    "nsr_unicos": len(nsr_counts),
    "nsr_duplicados": {k: v for k, v in nsr_counts.items() if v > 1},
    "identidade_duplicada": sum(v - 1 for v in identity_counts.values() if v > 1),
    "status": dict(sorted(valid_status.items())),
    "tipos_brutos": dict(sorted(raw_types.items())),
    "tipos_normalizados": dict(sorted(types.items())),
    "data_inicial": dates[0] if dates else None,
    "data_final": dates[-1] if dates else None,
    "registros_invalidos": len(invalid),
    "amostra_invalidos": invalid[:20],
    "funcionarios": employee_summary,
}
print(json.dumps(output, ensure_ascii=False, indent=2))

Path("/home/ubuntu/csv-complete-audit-detailed.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
Path("/home/ubuntu/pontovs_repo/docs/csv-complete-audit.md").write_text(
    "# Auditoria do CSV completo de marcações\n\n" +
    "Arquivo: `" + path.name + "`\n\n" +
    "SHA-256: `" + output["sha256"] + "`\n\n" +
    f"Registros de dados: **{output['registros']}**\n\n" +
    f"Matrículas: **{output['matriculas']}**\n\n" +
    f"Duplicidades pela chave NSR: **{len(output['nsr_duplicados'])}**; duplicidades por matrícula/data/hora/tipo: **{output['identidade_duplicada']}**\n\n" +
    f"Registros inválidos: **{output['registros_invalidos']}**\n\n" +
    "## Tipos normalizados\n\n" +
    "| Tipo | Quantidade |\n|---|---:|\n" +
    "\n".join(f"| `{key}` | {value} |" for key, value in sorted(types.items())) + "\n\n" +
    "## Observações\n\n" +
    "`SAIDA_ALMOCO` foi normalizado para `INTERVALO` e `VOLTA_ALMOCO` para `RETORNO`, como no importador atual.\n",
    encoding="utf-8",
)
if invalid or short_rows or output["nsr_duplicados"] or output["identidade_duplicada"]:
    raise SystemExit(2)
