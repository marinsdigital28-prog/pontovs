import { describe, expect, it, vi } from 'vitest';
import { applyPunchCorrection, createManualInclusion, planPunchCorrection } from '../lib/punch-correction';

const original = { id: 'p1', userId: 'u1', type: 'ENTRADA', timestamp: new Date('2026-10-20T11:15:00Z'), status: 'VALID' };

function fakeTx() {
  const punches = new Map<string, any>([[original.id, { ...original, origin: 'WEB', clientId: null }]]);
  const audits: any[] = [];
  return {
    punches, audits,
    punch: {
      findUnique: vi.fn(async ({ where }: any) => [...punches.values()].find((p) => p.clientId === where.clientId) || null),
      create: vi.fn(async ({ data }: any) => { punches.set(data.id, { ...data }); return { id: data.id, type: data.type, timestamp: data.timestamp, status: data.status, origin: data.origin }; }),
      update: vi.fn(async ({ where, data }: any) => { const p = punches.get(where.id); Object.assign(p, data); return p; }),
    },
    punchAudit: { create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
  };
}

describe('correção de marcação (Portaria 671)', () => {
  it('rejeita correção sem mudança ou de marcação cancelada', () => {
    expect(planPunchCorrection(original, 'ENTRADA', original.timestamp)).toMatchObject({ ok: false, status: 400 });
    expect(planPunchCorrection({ ...original, status: 'REJECTED' }, 'SAIDA', original.timestamp)).toMatchObject({ ok: false, status: 409 });
  });

  it('cancela a original sem sobrescrever horário/tipo/origem e inclui uma nova marcação manual', async () => {
    const tx = fakeTx();
    const next = new Date('2026-10-20T11:00:00Z');
    const plan = planPunchCorrection(original, 'ENTRADA', next);
    if (!plan.ok) throw new Error('plano inválido');
    const created = await applyPunchCorrection(tx, plan, { managerId: 'm1', reason: 'Colaborador esqueceu de bater' });

    const kept = tx.punches.get('p1');
    expect(kept.status).toBe('REJECTED');
    expect(kept.timestamp.toISOString()).toBe(original.timestamp.toISOString());
    expect(kept.type).toBe('ENTRADA');
    expect(kept.origin).toBe('WEB');

    expect(created.id).not.toBe('p1');
    expect(created.origin).toBe('ADJUSTED');
    expect(created.timestamp.toISOString()).toBe(next.toISOString());
    expect(tx.punches.size).toBe(2);

    const fields = tx.audits.map((a) => a.field);
    expect(fields).toEqual(expect.arrayContaining(['status', 'correcao_timestamp', 'manual_create']));
    expect(tx.audits.every((a) => a.reason === 'Colaborador esqueceu de bater' && a.changedById === 'm1')).toBe(true);
    expect(tx.audits.find((a) => a.field === 'manual_create').oldValue).toBe('p1');
  });

  it('não duplica inclusão manual igual', async () => {
    const tx = fakeTx();
    const input = { userId: 'u1', type: 'SAIDA', timestamp: new Date('2026-10-20T20:00:00Z'), managerId: 'm1', reason: 'Saída esquecida' };
    expect(await createManualInclusion(tx, input)).not.toBeNull();
    expect(await createManualInclusion(tx, input)).toBeNull();
  });
});
