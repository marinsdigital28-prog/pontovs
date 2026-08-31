'use client';

import { useEffect, useMemo, useState } from 'react';

export type EmployeeProfile = {
  phone?: string;
  personalEmail?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
  cep?: string;
  pis?: string;
  rg?: string;
  birthDate?: string;
  sex?: string;
  maritalStatus?: string;
  admissionDate?: string;
  department?: string;
  ctps?: string;
  ctpsSeries?: string;
  motherName?: string;
  fatherName?: string;
  jobTitleFromPdf?: string;
  remuneration?: string;
  [key: string]: string | undefined;
};

export type Employee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  cpf?: string | null;
  jobTitle?: string | null;
  workDays?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  scheduleByDay?: string | null;
  profile?: EmployeeProfile | null;
  active: boolean;
};

const emptyProfile: EmployeeProfile = {
  phone: '', personalEmail: '', address: '', number: '', complement: '', neighborhood: '',
  city: '', uf: 'RJ', cep: '', pis: '', rg: '', birthDate: '', sex: '', maritalStatus: '',
  admissionDate: '', department: '', ctps: '', ctpsSeries: '', motherName: '', fatherName: '',
};

function profileReadyForComms(p?: EmployeeProfile | null) {
  const phone = (p?.phone || '').replace(/\D/g, '');
  const email = (p?.personalEmail || '').trim();
  return { hasPhone: phone.length >= 10, hasEmail: email.includes('@') };
}

function formatAddress(p?: EmployeeProfile | null) {
  if (!p) return '—';
  const line1 = [p.address, p.number && `nº ${p.number}`, p.complement].filter(Boolean).join(', ');
  const line2 = [p.neighborhood, p.city && `${p.city}/${p.uf || ''}`, p.cep && `CEP ${p.cep}`].filter(Boolean).join(' · ');
  return [line1, line2].filter(Boolean).join(' — ') || '—';
}

export default function EmployeesPanel({
  employees: initial,
  onChanged,
}: {
  employees: Employee[];
  onChanged?: () => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>(initial);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [profileForm, setProfileForm] = useState<EmployeeProfile>(emptyProfile);
  const [nameForm, setNameForm] = useState('');
  const [jobTitleForm, setJobTitleForm] = useState('');
  const [cpfForm, setCpfForm] = useState('');

  useEffect(() => { setEmployees(initial); }, [initial]);

  const selected = useMemo(() => employees.find((e) => e.id === selectedId) || null, [employees, selectedId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter((e) => {
      const p = e.profile || {};
      return `${e.name} ${e.employeeNumber || ''} ${e.cpf || ''} ${e.jobTitle || ''} ${p.phone || ''} ${p.personalEmail || ''} ${p.city || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [employees, search]);

  const stats = useMemo(() => {
    let withPhone = 0, withEmail = 0, withDocs = 0;
    for (const e of employees) {
      const c = profileReadyForComms(e.profile);
      if (c.hasPhone) withPhone += 1;
      if (c.hasEmail) withEmail += 1;
      if (e.profile?.rg || e.profile?.pis || e.cpf) withDocs += 1;
    }
    return { total: employees.length, withPhone, withEmail, withDocs };
  }, [employees]);

  function openEmployee(employee: Employee) {
    setSelectedId(employee.id);
    setNameForm(employee.name);
    setJobTitleForm(employee.jobTitle || '');
    setCpfForm(employee.cpf || '');
    setProfileForm({ ...emptyProfile, ...(employee.profile || {}) });
    setMessage('');
  }

  async function reload() {
    const response = await fetch('/api/admin/employees', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const list = data.employees || [];
      setEmployees(list);
      onChanged?.();
      if (selectedId) {
        const again = list.find((e: Employee) => e.id === selectedId);
        if (again) openEmployee(again);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = initial.filter((e) => !(e.profile?.phone || e.profile?.personalEmail)).length;
      if (missing < Math.max(3, Math.floor(initial.length * 0.4))) return;
      if (typeof window !== 'undefined' && sessionStorage.getItem('enrich_auto_done') === '1') return;
      setEnriching(true);
      try {
        const response = await fetch('/api/admin/enrich-employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromBuiltin: true }),
        });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) {
          sessionStorage.setItem('enrich_auto_done', '1');
          setMessage(`Fichas importadas automaticamente: ${data.updated || 0} atualizados (matrícula/jornada preservadas).`);
          const r = await fetch('/api/admin/employees', { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            setEmployees(j.employees || []);
            onChanged?.();
          }
        }
      } catch {
        /* silencioso */
      } finally {
        if (!cancelled) setEnriching(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    const response = await fetch('/api/admin/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: selected.id,
        name: nameForm.trim(),
        cpf: cpfForm.trim() || null,
        jobTitle: jobTitleForm.trim() || null,
        profile: profileForm,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || 'Não foi possível salvar os dados cadastrais.');
    else {
      setMessage('Dados cadastrais salvos. Matrícula e jornada preservadas.');
      await reload();
    }
    setSaving(false);
  }

  async function enrichFromPdf() {
    setEnriching(true);
    setMessage('');
    const response = await fetch('/api/admin/enrich-employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBuiltin: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || 'Não foi possível importar as fichas cadastrais.');
    else {
      setMessage(`Fichas aplicadas: ${data.updated || 0} atualizados · matrícula e jornada intocadas.${data.skipped ? ` ${data.skipped} sem correspondência.` : ''}`);
      await reload();
    }
    setEnriching(false);
  }

  async function toggleActive(employee: Employee) {
    const response = await fetch('/api/admin/employees', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: employee.id, active: !employee.active }),
    });
    if (response.ok) {
      setMessage(employee.active ? 'Colaborador desativado.' : 'Colaborador ativado.');
      await reload();
    }
  }

  function setField(key: keyof EmployeeProfile, value: string) {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
  }

  const comms = profileReadyForComms(profileForm);

  return (
    <section className="admin-two-col employees-cadastro-layout">
      <div className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CADASTRO OPERACIONAL</span>
            <h2>Colaboradores</h2>
            <p className="small-muted">Contatos e documentos para comprovante por e-mail/SMS. Matrícula, dias e horários ficam na aba Turnos.</p>
          </div>
          <button type="button" className="primary-btn" disabled={enriching} onClick={() => void enrichFromPdf()}>
            {enriching ? 'Importando fichas...' : 'Importar fichas (PDF Alterdata)'}
          </button>
        </div>

        <div className="stat-grid admin-stat-grid" style={{ marginBottom: 12 }}>
          <div className="summary"><span className="small-muted">Equipe</span><strong>{stats.total}</strong></div>
          <div className="summary summary-ok"><span className="small-muted">Com celular</span><strong>{stats.withPhone}</strong></div>
          <div className="summary"><span className="small-muted">Com e-mail</span><strong>{stats.withEmail}</strong></div>
          <div className="summary"><span className="small-muted">Com docs</span><strong>{stats.withDocs}</strong></div>
        </div>

        <input className="input" placeholder="Buscar nome, matrícula, CPF, telefone, e-mail ou cidade" value={search} onChange={(e) => setSearch(e.target.value)} />

        <div className="employee-list" style={{ marginTop: 12 }}>
          {filtered.map((employee) => {
            const c = profileReadyForComms(employee.profile);
            const active = selectedId === employee.id;
            return (
              <div className={`employee-row ${active ? 'employee-row-active' : ''}`} key={employee.id} role="button" tabIndex={0} onClick={() => openEmployee(employee)} onKeyDown={(e) => e.key === 'Enter' && openEmployee(employee)} style={{ cursor: 'pointer' }}>
                <div>
                  <strong>{employee.name}</strong>
                  <div className="small-muted">{employee.employeeNumber || 'Sem matrícula'} · {employee.jobTitle || 'Cargo —'}{employee.cpf ? ` · CPF ${employee.cpf}` : ''}</div>
                  <div className="small-muted">
                    {employee.profile?.phone ? `📱 ${employee.profile.phone}` : '📱 sem celular'}{' · '}
                    {employee.profile?.personalEmail ? `✉️ ${employee.profile.personalEmail}` : '✉️ sem e-mail'}
                    {employee.profile?.city ? ` · ${employee.profile.city}/${employee.profile.uf || 'RJ'}` : ''}
                  </div>
                </div>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <span className={employee.active ? 'status-pill ok' : 'status-pill off'}>{employee.active ? 'Ativo' : 'Inativo'}</span>
                  <span className={c.hasPhone && c.hasEmail ? 'status-pill ok' : 'status-pill off'}>{c.hasPhone && c.hasEmail ? 'Contato OK' : 'Falta contato'}</span>
                  <button className="ghost-btn" type="button" onClick={() => openEmployee(employee)}>Abrir ficha</button>
                  <button className="ghost-btn" type="button" onClick={() => void toggleActive(employee)}>{employee.active ? 'Desativar' : 'Ativar'}</button>
                </div>
              </div>
            );
          })}
          {!filtered.length ? <p className="small-muted">Nenhum colaborador encontrado.</p> : null}
        </div>
        {message ? <p className="status-msg">{message}</p> : null}
      </div>

      <div className="card">
        {!selected ? (
          <div>
            <span className="eyebrow">FICHA CADASTRAL</span>
            <h2>Selecione um colaborador</h2>
            <p className="small-muted">Clique em alguém na lista para ver e editar documentos, endereço e canais de contato.</p>
          </div>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">FICHA CADASTRAL</span>
                <h2>{selected.name}</h2>
                <p className="small-muted">
                  Matrícula <strong>{selected.employeeNumber || '—'}</strong>
                  {' · '}Jornada <strong>{selected.scheduleStart || '—'} às {selected.scheduleEnd || '—'}</strong>
                  {' · '}Dias <strong>{selected.workDays || '—'}</strong>
                  <br /><em style={{ opacity: 0.85 }}>Matrícula e jornada não são editáveis nesta tela.</em>
                </p>
              </div>
            </div>

            <div className="form-two-col">
              <label className="small-muted">Nome completo<input className="input" value={nameForm} onChange={(e) => setNameForm(e.target.value)} /></label>
              <label className="small-muted">Cargo<input className="input" value={jobTitleForm} onChange={(e) => setJobTitleForm(e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">CPF<input className="input" value={cpfForm} onChange={(e) => setCpfForm(e.target.value)} /></label>
              <label className="small-muted">Departamento<input className="input" value={profileForm.department || ''} onChange={(e) => setField('department', e.target.value)} /></label>
            </div>

            <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: 15 }}>Contato (comprovante e-mail / SMS)</h3>
            <div className="form-two-col">
              <label className="small-muted">Celular / WhatsApp<input className="input" value={profileForm.phone || ''} onChange={(e) => setField('phone', e.target.value)} /></label>
              <label className="small-muted">E-mail pessoal<input className="input" type="email" value={profileForm.personalEmail || ''} onChange={(e) => setField('personalEmail', e.target.value)} /></label>
            </div>
            <p className="certificate-help">
              {comms.hasPhone && comms.hasEmail ? '✓ Celular e e-mail prontos para envio de comprovante.' : !comms.hasPhone && !comms.hasEmail ? 'Informe celular e e-mail para habilitar comprovante.' : !comms.hasPhone ? 'Falta celular para SMS.' : 'Falta e-mail.'}
            </p>

            <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: 15 }}>Endereço</h3>
            <label className="small-muted">Logradouro<input className="input" value={profileForm.address || ''} onChange={(e) => setField('address', e.target.value)} /></label>
            <div className="form-two-col">
              <label className="small-muted">Número<input className="input" value={profileForm.number || ''} onChange={(e) => setField('number', e.target.value)} /></label>
              <label className="small-muted">Complemento<input className="input" value={profileForm.complement || ''} onChange={(e) => setField('complement', e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">Bairro<input className="input" value={profileForm.neighborhood || ''} onChange={(e) => setField('neighborhood', e.target.value)} /></label>
              <label className="small-muted">CEP<input className="input" value={profileForm.cep || ''} onChange={(e) => setField('cep', e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">Cidade<input className="input" value={profileForm.city || ''} onChange={(e) => setField('city', e.target.value)} /></label>
              <label className="small-muted">UF<input className="input" value={profileForm.uf || ''} onChange={(e) => setField('uf', e.target.value)} maxLength={2} /></label>
            </div>
            <p className="small-muted" style={{ marginTop: 4 }}>{formatAddress(profileForm)}</p>

            <h3 style={{ marginTop: 16, marginBottom: 8, fontSize: 15 }}>Documentos e filiação</h3>
            <div className="form-two-col">
              <label className="small-muted">RG<input className="input" value={profileForm.rg || ''} onChange={(e) => setField('rg', e.target.value)} /></label>
              <label className="small-muted">PIS/PASEP<input className="input" value={profileForm.pis || ''} onChange={(e) => setField('pis', e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">CTPS<input className="input" value={profileForm.ctps || ''} onChange={(e) => setField('ctps', e.target.value)} /></label>
              <label className="small-muted">Série CTPS<input className="input" value={profileForm.ctpsSeries || ''} onChange={(e) => setField('ctpsSeries', e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">Nascimento<input className="input" value={profileForm.birthDate || ''} onChange={(e) => setField('birthDate', e.target.value)} /></label>
              <label className="small-muted">Admissão<input className="input" value={profileForm.admissionDate || ''} onChange={(e) => setField('admissionDate', e.target.value)} /></label>
            </div>
            <div className="form-two-col">
              <label className="small-muted">Sexo<input className="input" value={profileForm.sex || ''} onChange={(e) => setField('sex', e.target.value)} /></label>
              <label className="small-muted">Estado civil<input className="input" value={profileForm.maritalStatus || ''} onChange={(e) => setField('maritalStatus', e.target.value)} /></label>
            </div>
            <label className="small-muted">Nome da mãe<input className="input" value={profileForm.motherName || ''} onChange={(e) => setField('motherName', e.target.value)} /></label>
            <label className="small-muted">Nome do pai<input className="input" value={profileForm.fatherName || ''} onChange={(e) => setField('fatherName', e.target.value)} /></label>

            <div className="row-actions" style={{ marginTop: 16 }}>
              <button className="primary-btn" type="button" disabled={saving} onClick={() => void saveProfile()}>{saving ? 'Salvando...' : 'Salvar dados cadastrais'}</button>
              <button className="ghost-btn" type="button" onClick={() => setSelectedId(null)}>Fechar ficha</button>
            </div>
            {message ? <p className="status-msg">{message}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
