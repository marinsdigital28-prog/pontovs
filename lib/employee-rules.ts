/**
 * Regras individuais do classificador, guardadas no cadastro (profileJson, mesclado nas edições do painel).
 *  - jornadaFlexivel: true → pessoa sem horário fixo (ex.: Cássio 0506, vice-diretor). O sistema nunca preenche
 *    horário automaticamente nem "força padrão": toda leitura dele vai como DÚVIDA, sem horário inventado.
 * O almoço fixo (ex.: Robson 10:30–11:30) fica na escala por dia (scheduleByDay: lunchStart/lunchEnd).
 */
export type ClassifierProfile = { flexible: boolean };

export function classifierProfile(profileJson?: string | null): ClassifierProfile {
  if (!profileJson) return { flexible: false };
  try {
    const p = JSON.parse(profileJson);
    return { flexible: Boolean(p && typeof p === 'object' && p.jornadaFlexivel === true) };
  } catch {
    return { flexible: false };
  }
}
