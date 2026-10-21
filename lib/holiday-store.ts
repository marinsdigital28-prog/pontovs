import prisma from './prisma';
import { HOLIDAY_ACTIONS, overridesFromEvents, setHolidayOverrides, type HolidayOverrides } from './holidays';

/** Carrega os ajustes de feriados do gestor (eventos de auditoria) e registra para os cálculos. */
export async function loadHolidayOverrides(): Promise<HolidayOverrides> {
  try {
    const events = await prisma.securityAuditEvent.findMany({ where: { action: { in: HOLIDAY_ACTIONS } }, orderBy: { createdAt: 'asc' }, select: { action: true, metadataJson: true }, take: 5000 });
    const overrides = overridesFromEvents(events.map((e) => { let metadata: any = null; try { metadata = JSON.parse(e.metadataJson || 'null'); } catch {} return { action: e.action, metadata }; }));
    setHolidayOverrides(overrides);
    return overrides;
  } catch (error) {
    console.error('holiday overrides load failed', error);
    return { added: [], disabled: [], enabled: [] };
  }
}
