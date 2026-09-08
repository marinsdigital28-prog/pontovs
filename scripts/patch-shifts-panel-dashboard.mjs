import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'app/admin/admin-dashboard.tsx');
let t = fs.readFileSync(p, 'utf8');

if (!t.includes("from './shifts-panel'")) {
  t = t.replace(
    "import OverviewExitWatch from './overview-exit-watch';",
    "import OverviewExitWatch from './overview-exit-watch';\nimport ShiftsPanel from './shifts-panel';",
  );
}

if (!t.includes('<ShiftsPanel')) {
  const re = /\{tab === 'shifts' \? <section className="admin-two-col">[\s\S]*?<\/section> : null\}/;
  const neu = `{tab === 'shifts' ? <section className="admin-shifts-layout">
      <ShiftsPanel
        employees={employees}
        scheduleApplying={scheduleApplying}
        onApplyPatterns={() => void applySchedulePatterns()}
        onEdit={(employee) => startEdit(employee)}
      />
      <div className="card shifts-form-card">
        <div className="section-heading"><div><h2>{editing ? 'Editar jornada' : 'Nova jornada / colaborador'}</h2><p className="small-muted">Matrícula e horários de expediente.</p></div>{editing ? <button className="ghost-btn" onClick={resetForm}>Cancelar</button> : null}</div>
        <form onSubmit={saveEmployee} className="admin-form">
          {[['name', 'Nome completo'], ['employeeNumber', 'Matrícula'], ['cpf', 'CPF'], ['jobTitle', 'Cargo'], ['workDays', 'Dias trabalhados'], ['scheduleStart', 'Início da jornada'], ['scheduleEnd', 'Fim da jornada']].map(([key, label]) => (
            <label key={key} className="small-muted">{label}<input className="input" required={key === 'name' || key === 'employeeNumber'} value={form[key as keyof typeof form]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
          ))}
          <button className="primary-btn" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar jornada' : 'Cadastrar'}</button>
        </form>
      </div>
    </section> : null}`;
  if (re.test(t)) {
    t = t.replace(re, neu);
    console.log('shifts panel wired');
  } else {
    console.log('shifts pattern not found');
  }
}

fs.writeFileSync(p, t);
console.log('ShiftsPanel', t.includes('ShiftsPanel'));
