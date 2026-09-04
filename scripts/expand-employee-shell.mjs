import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'app/app/employee-shell.tsx');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

const BASE =
  'https://raw.githubusercontent.com/marinsdigital28-prog/pontovs/225e7421df9312e57af678440ec5e052fa74a21e/app/app/page.tsx';

let t = await get(BASE);

if (!t.includes("import './emp-radar.css'")) {
  t = t.replace("import './emp-app.css';", "import './emp-app.css';\nimport './emp-radar.css';");
}

if (!t.includes('sosLoading')) {
  t = t.replace(
    "const [quickForgotDone, setQuickForgotDone] = useState(false);",
    "const [quickForgotDone, setQuickForgotDone] = useState(false);\n  const [sosLoading, setSosLoading] = useState(false);\n  const [sosDone, setSosDone] = useState('');",
  );
}

if (!t.includes('journeyRadar')) {
  const radar = `
  const journeyRadar = useMemo(() => {
    const start = data?.employee?.scheduleStart;
    const end = data?.employee?.scheduleEnd;
    const types = new Set(todayPunches.map((p) => p.type));
    const last = todayPunches[todayPunches.length - 1];
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const hv = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const nowMin = Number(hv.hour) * 60 + Number(hv.minute);
    const toMin = (hhmm) => {
      if (!hhmm || !/^\\d{1,2}:\\d{2}$/.test(hhmm)) return null;
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const startMin = toMin(start);
    const endMin = toMin(end);
    let title = 'Sem jornada cadastrada';
    let detail = 'Peça à ADM para conferir seu horário.';
    let nextExpected: string | null = null;
    let delayMin: number | null = null;
    let tone = 'neutral';
    if (types.has('SAIDA') && types.has('ENTRADA')) {
      title = 'Jornada completa';
      detail = 'Entrada e saída registradas hoje.';
      tone = 'ok';
    } else if (types.has('INTERVALO') && !types.has('RETORNO') && !types.has('SAIDA')) {
      title = 'Em intervalo';
      detail = last ? \`Última batida: \${TYPE_LABEL[last.type] || last.type} às \${timeFmt.format(new Date(last.timestamp))}\` : 'Intervalo em andamento.';
      nextExpected = 'Retorno do intervalo';
      tone = 'warn';
    } else if (types.has('ENTRADA') || types.has('RETORNO')) {
      if (endMin !== null && nowMin >= endMin + 10 && !types.has('SAIDA')) {
        title = 'Deveria ter saída';
        detail = \`Horário de saída previsto: \${end}. Ainda sem batida de saída.\`;
        nextExpected = \`Saída (~\${end})\`;
        delayMin = nowMin - endMin;
        tone = 'alert';
      } else {
        title = 'Dentro da jornada';
        detail = last ? \`Última: \${TYPE_LABEL[last.type] || last.type} · \${timeFmt.format(new Date(last.timestamp))}\` : 'Em expediente.';
        nextExpected = end ? \`Saída (~\${end})\` : null;
        tone = 'ok';
      }
    } else if (startMin !== null && nowMin >= startMin + 10) {
      title = 'Sem entrada registrada';
      detail = \`Entrada prevista às \${start}. Ainda não há batida no sistema.\`;
      nextExpected = \`Entrada (~\${start})\`;
      delayMin = nowMin - startMin;
      tone = 'alert';
    } else if (startMin !== null) {
      title = 'Antes do expediente';
      detail = \`Entrada prevista às \${start}.\`;
      nextExpected = \`Entrada (~\${start})\`;
      tone = 'neutral';
    }
    return { title, detail, nextExpected, delayMin, tone, typesCount: todayPunches.length };
  }, [data?.employee?.scheduleStart, data?.employee?.scheduleEnd, todayPunches]);
`;
  t = t.replace(
    '  }, [data?.employee?.scheduleStart, data?.employee?.scheduleEnd, todayPunches]);\n\n  async function quickForgot',
    '  }, [data?.employee?.scheduleStart, data?.employee?.scheduleEnd, todayPunches]);\n' + radar + '\n  async function quickForgot',
  );
}

if (!t.includes('async function sendSos')) {
  const sos = `
  async function sendSos(kind) {
    if (sosLoading || sosDone) return;
    setSosLoading(true); setError('');
    const nowParts = new Intl.DateTimeFormat('pt-BR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const tv = Object.fromEntries(nowParts.map((p) => [p.type, p.value]));
    const approxTime = \`\${tv.hour}:\${tv.minute}\`;
    let payload;
    if (kind === 'HONESTY') {
      const missing = !todayPunches.some((p) => p.type === 'ENTRADA') ? 'ENTRADA' : !todayPunches.some((p) => p.type === 'SAIDA') ? 'SAIDA' : 'ENTRADA';
      payload = { type: 'ESQUECI_PONTO', startDate: todayKey, endDate: todayKey, reason: \`Modo honestidade: o dia não ficou redondo (~\${approxTime})\`, details: \`Radar: \${journeyRadar.title}. \${journeyRadar.detail}\`, classification: missing };
    } else if (kind === 'ATRASO') {
      payload = { type: 'AVISO_ATRASO', startDate: todayKey, endDate: todayKey, reason: \`Atraso no trajeto / imprevisto (~\${approxTime})\`, details: 'Enviado pelo SOS do app', classification: 'EMERGENCIA', returnExpected: true };
    } else if (kind === 'NAO_VENHO') {
      payload = { type: 'AUSENCIA', startDate: todayKey, endDate: todayKey, reason: 'Não poderei comparecer hoje', details: 'SOS app — emergência no dia', classification: 'EMERGENCIA', returnExpected: false };
    } else {
      payload = { type: 'AUSENCIA', startDate: todayKey, endDate: todayKey, reason: 'Atividade / evento externo', details: 'SOS app — em atividade externa', classification: 'EMERGENCIA', returnExpected: true };
    }
    try {
      const res = await fetch('/api/employee/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || 'Não foi possível avisar a ADM.'); setSosLoading(false); return; }
      const labels = { HONESTY: 'Aviso de dia incompleto enviado', ATRASO: 'Aviso de atraso enviado', NAO_VENHO: 'Ausência enviada', EXTERNO: 'Atividade externa enviada' };
      setSosDone(labels[kind]);
      notifyPopup('Espaço Progredir', labels[kind], \`sos-\${kind}\`);
      void loadRequests();
    } catch { setError('Falha de conexão ao avisar a ADM.'); }
    setSosLoading(false);
  }
`;
  t = t.replace('setQuickForgotLoading(false);\n  }\n\n  const lastPhoto', 'setQuickForgotLoading(false);\n  }\n' + sos + '\n  const lastPhoto');
}

if (!t.includes('emp-radar tone-')) {
  const inject = `            <div className={\`emp-radar tone-\${journeyRadar.tone}\`}>
              <div className="emp-radar-top">
                <span className="emp-radar-eyebrow">RADAR DA JORNADA</span>
                <strong>{journeyRadar.title}</strong>
                <p>{journeyRadar.detail}</p>
              </div>
              <div className="emp-radar-meta">
                {journeyRadar.nextExpected ? (
                  <div><span>Próxima esperada</span><b>{journeyRadar.nextExpected}</b></div>
                ) : (
                  <div><span>Status</span><b>{journeyRadar.typesCount ? \`\${journeyRadar.typesCount} batida(s)\` : 'Sem batidas'}</b></div>
                )}
                {journeyRadar.delayMin !== null && journeyRadar.delayMin > 0 ? (
                  <div><span>Desvio</span><b>+{journeyRadar.delayMin} min</b></div>
                ) : (
                  <div><span>Jornada</span><b>{emp?.scheduleStart || '--:--'}–{emp?.scheduleEnd || '--:--'}</b></div>
                )}
              </div>
            </div>

            <div className="emp-sos">
              <div className="emp-sos-head">
                <span className="emp-radar-eyebrow">MODO HONESTIDADE · SOS</span>
                <strong>Um toque para a ADM</strong>
                <p>Use quando o dia não ficou redondo ou houve imprevisto.</p>
              </div>
              {sosDone ? (
                <div className="emp-alert-miss ok"><strong>{sosDone}</strong><p>A administração já pode ver em Solicitações.</p></div>
              ) : (
                <div className="emp-sos-grid">
                  <button type="button" className="emp-btn primary" disabled={sosLoading} onClick={() => void sendSos('HONESTY')}>Hoje não ficou redondo</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('ATRASO')}>Vou / estou atrasado</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('NAO_VENHO')}>Não venho hoje</button>
                  <button type="button" className="emp-btn" disabled={sosLoading} onClick={() => void sendSos('EXTERNO')}>Estou em atividade externa</button>
                </div>
              )}
            </div>

`;
  t = t.replace('            {missingPunchHint && !quickForgotDone ? (', inject + '            {missingPunchHint && !quickForgotDone ? (');
}

if (!t.includes('emp-timeline-photo')) {
  t = t.replace(
    `                <ul className="emp-timeline">
                  {todayPunches.map((p) => (
                    <li key={p.id} className="emp-timeline-row">
                      {p.photoData ? <img src={p.photoData} alt="" className="emp-thumb" /> : <span className="emp-thumb placeholder" />}
                      <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                      <span>{TYPE_LABEL[p.type] || p.type}</span>
                      <span className="emp-pill ok">OK</span>
                    </li>
                  ))}
                </ul>`,
    `                <ul className="emp-timeline emp-timeline-photo">
                  {todayPunches.map((p) => (
                    <li key={p.id} className="emp-timeline-row emp-timeline-photo-row">
                      <div className="emp-tl-photo">
                        {p.photoData ? <img src={p.photoData} alt={\`Foto \${TYPE_LABEL[p.type] || p.type}\`} /> : <span className="emp-thumb placeholder">Sem foto</span>}
                      </div>
                      <div className="emp-tl-body">
                        <strong>{TYPE_LABEL[p.type] || p.type}</strong>
                        <span className="emp-time">{timeFmt.format(new Date(p.timestamp))}</span>
                        <span className="emp-pill ok">Registrada</span>
                      </div>
                    </li>
                  ))}
                </ul>`,
  );
}

fs.writeFileSync(outPath, t);
console.log('expanded employee-shell.tsx', t.length, 'bytes · radar', t.includes('journeyRadar'), 'sos', t.includes('sendSos'));
