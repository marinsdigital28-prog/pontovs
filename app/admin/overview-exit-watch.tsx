'use client';

import { useMemo } from 'react';

type PresenceEmployee = {
  id: string;
  name: string;
  employeeNumber: string | null;
  status: 'PRESENTE' | 'NAO_MARCOU' | 'PENDENTE' | 'SAIU' | 'FOLGA';
  latestPunch: { id: string; type: string; timestamp: string; status: string; hasPhoto: boolean } | null;
};

type Emp = {
  id: string;
  name: string;
  employeeNumber: string | null;
  scheduleEnd?: string | null;
  profile?: { phone?: string; [key: string]: string | undefined } | null;
};

function digitsPhone(raw?: string | null) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '');
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  if (d.length >= 12) return d;
  return '';
}

function pastScheduleEnd(scheduleEnd?: string | null) {
  if (!scheduleEnd || !/^\d{1,2}:\d{2}$/.test(scheduleEnd)) return true;
  const [h, m] = scheduleEnd.split(':').map(Number);
  const now = new Date();
  const end = new Date();
  end.setHours(h, m, 0, 0);
  return now.getTime() >= end.getTime();
}

export default function OverviewExitWatch({
  presence,
  employees,
}: {
  presence: PresenceEmployee[];
  employees: Emp[];
}) {
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const missingExit = useMemo(() => {
    return presence
      .filter((p) => p.status === 'PRESENTE')
      .map((p) => {
        const emp = byId.get(p.id);
        return {
          ...p,
          scheduleEnd: emp?.scheduleEnd || null,
          phone: emp?.profile?.phone || null,
          pastEnd: pastScheduleEnd(emp?.scheduleEnd),
        };
      })
      .filter((p) => p.pastEnd)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [presence, byId]);

  const noShow = useMemo(
    () =>
      presence
        .filter((p) => p.status === 'NAO_MARCOU')
        .map((p) => {
          const emp = byId.get(p.id);
          return { ...p, phone: emp?.profile?.phone || null };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [presence, byId],
  );

  const waLink = (name: string, phone: string | null | undefined, kind: 'saida' | 'entrada') => {
    const d = digitsPhone(phone);
    if (!d) return null;
    const msg =
      kind === 'saida'
        ? `Olá ${name.split(' ')[0]}, aqui é da Administração do Espaço Progredir. Notamos que ainda não há marcação de saída no ponto de hoje. Pode verificar, por favor?`
        : `Olá ${name.split(' ')[0]}, aqui é da Administração do Espaço Progredir. Ainda não registramos sua entrada no ponto de hoje. Pode conferir?`;
    return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="card overview-exit-watch">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ALERTA OPERACIONAL</span>
          <h3>Sem saída / sem entrada</h3>
          <p className="small-muted">
            Após o horário previsto · WhatsApp quando houver telefone no cadastro
          </p>
        </div>
      </div>

      <div className="ov-watch-block">
        <strong className="ov-watch-label">
          Presentes sem saída ({missingExit.length})
        </strong>
        {!missingExit.length ? (
          <p className="small-muted">Ninguém nesta situação agora.</p>
        ) : (
          <ul className="ov-watch-list">
            {missingExit.map((p) => {
              const link = waLink(p.name, p.phone, 'saida');
              return (
                <li key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <small>
                      Mat. {p.employeeNumber || '—'}
                      {p.scheduleEnd ? ` · fim ${p.scheduleEnd}` : ''}
                      {p.latestPunch
                        ? ` · última ${p.latestPunch.type}`
                        : ''}
                    </small>
                  </div>
                  {link ? (
                    <a className="primary-btn compact-btn ov-wa-btn" href={link} target="_blank" rel="noreferrer">
                      WhatsApp
                    </a>
                  ) : (
                    <span className="small-muted">Sem tel.</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="ov-watch-block">
        <strong className="ov-watch-label">Não marcaram entrada ({noShow.length})</strong>
        {!noShow.length ? (
          <p className="small-muted">Todos os escalados já batiram ou estão de folga.</p>
        ) : (
          <ul className="ov-watch-list">
            {noShow.slice(0, 8).map((p) => {
              const link = waLink(p.name, p.phone, 'entrada');
              return (
                <li key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <small>Mat. {p.employeeNumber || '—'}</small>
                  </div>
                  {link ? (
                    <a className="ghost-btn compact-btn ov-wa-btn" href={link} target="_blank" rel="noreferrer">
                      WhatsApp
                    </a>
                  ) : (
                    <span className="small-muted">Sem tel.</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
