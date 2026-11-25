/** Nome curto legível ("CRISTIANO FERREIRA DA SILVA" → "Cristiano Ferreira"). */
const PARTICLES = new Set(['da', 'de', 'do', 'dos', 'das', 'e']);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
export function shortName(full: string) {
  const parts = String(full || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const first = parts[0] || ''; const second = parts.slice(1).find((w) => !PARTICLES.has(w)) || '';
  return [first, second].filter(Boolean).map((w) => w.split('-').map(cap).join('-')).join(' ');
}
