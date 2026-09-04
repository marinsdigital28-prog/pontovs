'use client';

import { useCallback, useEffect, useState } from 'react';
import AbsenceCalendar from './absence-calendar';

type Req = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string;
  details?: string | null;
  classification?: string | null;
  employee: { name: string; employeeNumber: string | null };
};

type Cert = {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  observation?: string | null;
  user: { name: string; employeeNumber: string | null };
};

/** Carrega solicitações + atestados e renderiza o calendário de ausências. */
export default function AbsenceCalendarLive() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [certificates, setCertificates] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/admin/requests', { cache: 'no-store' }),
        fetch('/api/admin/certificates', { cache: 'no-store' }),
      ]);
      const rJson = await rRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      if (!rRes.ok && !cRes.ok) throw new Error(rJson.error || cJson.error || 'Falha ao carregar calendário');

      const reqs = Array.isArray(rJson.requests) ? rJson.requests : Array.isArray(rJson.items) ? rJson.items : [];
      setRequests(
        reqs.map((r: any) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate || r.startDate,
          reason: r.reason || '',
          details: r.details ?? null,
          classification: r.classification ?? r.flag ?? null,
          employee: {
            name: r.employee?.name || r.user?.name || 'Colaborador',
            employeeNumber: r.employee?.employeeNumber || r.user?.employeeNumber || null,
          },
        })),
      );

      const certs = Array.isArray(cJson.certificates) ? cJson.certificates : Array.isArray(cJson.items) ? cJson.items : [];
      setCertificates(
        certs.map((c: any) => ({
          id: c.id,
          type: c.type || 'Atestado',
          status: c.status,
          startDate: c.startDate,
          endDate: c.endDate || c.startDate,
          startTime: c.startTime,
          endTime: c.endTime,
          observation: c.observation || c.notes || null,
          user: {
            name: c.user?.name || c.employee?.name || 'Colaborador',
            employeeNumber: c.user?.employeeNumber || c.employee?.employeeNumber || null,
          },
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o calendário de ausências.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="absence-calendar-live-wrap">
      <div className="absence-calendar-live-bar">
        <button type="button" className="ghost-btn compact-btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar calendário'}
        </button>
        {error ? <span className="status-msg">{error}</span> : null}
      </div>
      <AbsenceCalendar requests={requests} certificates={certificates} />
    </div>
  );
}
