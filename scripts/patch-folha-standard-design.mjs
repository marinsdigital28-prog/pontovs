import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelPath = path.join(root, 'app/admin/folha-ponto-panel.tsx');
if (!fs.existsSync(panelPath)) throw new Error('painel da folha ausente');
let t = fs.readFileSync(panelPath, 'utf8');
if (!t.includes('export default function FolhaPontoPanel')) {
  throw new Error('painel da folha ainda não foi restaurado antes do patch de padrão');
}

// Cabeçalho: logo e nome institucional à esquerda, somente o título centralizado.
if (!t.includes('folha-print-topbar')) {
  const startMarker = '              <div className="folha-print-header">';
  const endMarker = '              </div>\n              <div className="row-actions no-print">';
  const start = t.indexOf(startMarker);
  const end = start >= 0 ? t.indexOf(endMarker, start) : -1;
  if (start < 0 || end < 0) throw new Error('não foi possível localizar o cabeçalho atual da folha');
  const replacement = [
    '              <div className="folha-print-header">',
    '                <div className="folha-print-topbar">',
    '                  <div className="folha-print-brand">',
    '                    <img className="folha-print-logo" src="/espaco-progredir-logo.jpeg" alt="" />',
    '                    <span className="folha-print-org">ESPAÇO PROGREDIR</span>',
    '                  </div>',
    '                  <h2 className="folha-print-title">FOLHA DE PONTO</h2>',
    '                  <span className="folha-print-topbar-spacer" aria-hidden="true" />',
    '                </div>',
    '                <h3 className="folha-employee-name">{employee.name}</h3>',
    '                <p className="folha-print-meta">',
    '                  <span><b>Matrícula:</b> {employee.employeeNumber || "—"}</span>',
    '                  <span><b>CPF:</b> {employee.cpf || "CPF não cadastrado"}</span>',
    '                  <span><b>Cargo:</b> {employee.jobTitle || "—"}</span>',
    '                </p>',
    '                <p className="folha-print-meta">',
    '                  <span><b>Jornada:</b> {employee.scheduleStart && employee.scheduleEnd ? employee.scheduleStart.slice(0, 5) + "–" + employee.scheduleEnd.slice(0, 5) : "Conforme escala"}</span>',
    '                  <span><b>Competência:</b> {monthLabel(month)}</span>',
    '                </p>',
    '              </div>\n              <div className="row-actions no-print">',
  ].join('\n');
  t = t.slice(0, start) + replacement + t.slice(end + endMarker.length);
}

// Dados do evento justificador, para não reduzir todo registro a “abono + ponto”.
if (!t.includes('eventLabel: registeredEventLabel')) {
  const typeLine = '  absent: boolean; late: boolean; certificate: boolean; incomplete: boolean; schedule: string;';
  if (!t.includes(typeLine)) throw new Error('tipo DayRow não localizado');
  t = t.replace(typeLine, `${typeLine}\n  eventLabel: string; eventTime: string;`);
}

if (!t.includes('const certificateTypeLabels: Record<string, string>')) {
  const anchor = "const allEmployeesValue = '__ALL__';";
  if (!t.includes(anchor)) throw new Error('local do mapa de tipos de atestado não localizado');
  t = t.replace(anchor, `${anchor}\nconst certificateTypeLabels: Record<string, string> = {\n  DIA_INTEGRAL: 'Atestado',\n  PERIODO_DIAS: 'Atestado',\n  HORAS: 'Atestado',\n  PERIODO_HORAS: 'Atestado',\n  CONSULTA_MEDICA: 'Consulta médica',\n  SAIDA_MEDICA: 'Saída médica',\n  TRABALHO_EXTERNO: 'Trabalho externo',\n  TRABALHO_EXTERNO_HORAS: 'Trabalho externo',\n  OUTRO: 'Atestado — outro',\n};`);
}

if (!t.includes('let registeredEventLabel =')) {
  const anchor = '    return {\n      date, weekday: weekdayNames[weekday], punches: dayPunches,';
  if (!t.includes(anchor)) throw new Error('retorno diário da folha não localizado');
  const eventLogic = [
    '    let registeredEventLabel = "";',
    '    let registeredEventTime = "";',
    '    if (certificate && ["APROVADO", "ATIVO"].includes(certificate.status) && justifiedByCertificate > 0) {',
    '      registeredEventLabel = certificateTypeLabels[certificate.type || ""] || "Atestado";',
    '      if (certificate.startTime && certificate.endTime) {',
    '        registeredEventTime = `${certificate.startTime.slice(0, 5)}–${certificate.endTime.slice(0, 5)}`;',
    '      } else if (certificate.hoursPerDayMinutes != null) {',
    '        const minutes = certificate.hoursPerDayMinutes;',
    '        registeredEventTime = `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;',
    '      } else {',
    '        registeredEventTime = "Dia integral";',
    '      }',
    '    } else if (approvedRequest?.type === "AUSENCIA" && justifiedByRequest > 0) {',
    '      registeredEventLabel = approvedRequest.reason || "Ausência aprovada";',
    '      registeredEventTime = "Dia integral";',
    '    } else if (opsAbono && justifiedByOps > 0) {',
    '      registeredEventLabel = opsAbono.reason;',
    '      const eventEnd = (daySchedule?.end || employee.scheduleEnd || "").slice(0, 5);',
    '      registeredEventTime = opsAbono.kind === "FROM_TIME" && opsAbono.fromTime && eventEnd',
    '        ? `${opsAbono.fromTime.slice(0, 5)}–${eventEnd}`',
    '        : "Dia integral";',
    '    }',
  ].join('\n');
  t = t.replace(anchor, `${eventLogic}\n${anchor}`);
}

if (!t.includes('eventTime: registeredEventTime')) {
  const anchor = '      certificate: covered, incomplete, schedule: scheduleLabel,';
  if (!t.includes(anchor)) throw new Error('campos de retorno do dia não localizados');
  t = t.replace(anchor, `${anchor}\n      eventLabel: registeredEventLabel, eventTime: registeredEventTime,`);
}

const situationStart = '                    const situation = row.certificate || (row.justified && row.justified > 0)';
const rowReturn = '                    return (\n                      <tr key={row.date}';
if (t.includes(situationStart)) {
  const start = t.indexOf(situationStart);
  const end = t.indexOf(rowReturn, start);
  if (end < 0) throw new Error('bloco de Situação da folha não localizado');
  const replacement = [
    '                    const situation = row.eventLabel',
    '                      ? row.eventLabel',
    "                      : row.absent ? 'FALTA'",
    "                      : row.incomplete ? 'INCOMPLETO'",
    "                      : row.late ? ''",
    "                      : isFolga ? 'FOLGA'",
    "                      : row.punches.length ? 'OK' : '';",
    '                    const sitClass = row.eventLabel ? \'folha-sit-abono\' :',
    "                      situation === 'FALTA' ? 'folha-sit-falta'",
    "                      : situation === 'INCOMPLETO' ? 'folha-sit-incompleto'",
    "                      : situation === 'FOLGA' ? 'folha-sit-folga'",
    "                      : situation === 'OK' ? 'folha-sit-ok'",
    "                      : '';",
  ].join('\n');
  t = t.slice(0, start) + replacement + '\n' + t.slice(end);
}

const cellPattern = /<td className="folha-col-sit">\{situation \? <span className=\{`folha-sit \$\{sitClass\}`}\>\{situation\}<\/span> : '—'\}<\/td>/;
if (cellPattern.test(t)) {
  const cell = [
    '                        <td className="folha-col-sit">',
    '                          {row.eventLabel ? (',
    '                            <span className="folha-sit folha-sit-abono folha-sit-detail">',
    '                              <b>{row.eventLabel}</b>',
    '                              {row.eventTime ? <small>{row.eventTime}</small> : null}',
    '                            </span>',
    '                          ) : situation ? <span className={`folha-sit ${sitClass}`}>{situation}</span> : \'—\'}',
    '                        </td>',
  ].join('\n');
  t = t.replace(cellPattern, cell);
} else if (!t.includes('folha-sit-detail')) {
  throw new Error('célula de Situação não localizada para exibição dos horários');
}

fs.writeFileSync(panelPath, t);
console.log('folha padrão aplicado', fs.statSync(panelPath).size, 'bytes');
