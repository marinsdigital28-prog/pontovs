/** Mascote Pontinho (SVG inline, sem assets). */
export default function PontinhoIcon({ size = 48 }: { size?: number }) {
  return <svg width={size} height={size * 130 / 120} viewBox="0 0 120 130" aria-hidden="true">
    <line x1="60" y1="6" x2="60" y2="20" stroke="#0b5c42" strokeWidth="4" strokeLinecap="round" /><circle cx="60" cy="6" r="6" fill="#c9a227" />
    <rect x="8" y="50" width="12" height="26" rx="6" fill="#0b5c42" /><rect x="100" y="44" width="12" height="26" rx="6" fill="#0b5c42" transform="rotate(-25 106 57)" />
    <rect x="30" y="92" width="60" height="30" rx="12" fill="#0b5c42" /><rect x="48" y="100" width="24" height="12" rx="4" fill="#c9a227" />
    <circle cx="60" cy="60" r="42" fill="#fff" stroke="#0b5c42" strokeWidth="7" />
    <g stroke="#9cc5a9" strokeWidth="3" strokeLinecap="round"><line x1="60" y1="24" x2="60" y2="30" /><line x1="60" y1="90" x2="60" y2="96" /><line x1="24" y1="60" x2="30" y2="60" /><line x1="90" y1="60" x2="96" y2="60" /></g>
    <ellipse cx="46" cy="54" rx="6" ry="8" fill="#143d1f" /><ellipse cx="74" cy="54" rx="6" ry="8" fill="#143d1f" />
    <circle cx="48" cy="51" r="2" fill="#fff" /><circle cx="76" cy="51" r="2" fill="#fff" />
    <circle cx="36" cy="68" r="5" fill="#f4b6a6" opacity=".8" /><circle cx="84" cy="68" r="5" fill="#f4b6a6" opacity=".8" />
    <path d="M48 72 Q60 82 72 72" stroke="#143d1f" strokeWidth="4" fill="none" strokeLinecap="round" />
    <line x1="60" y1="60" x2="60" y2="36" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" opacity=".55" /><line x1="60" y1="60" x2="78" y2="62" stroke="#c9a227" strokeWidth="3" strokeLinecap="round" opacity=".55" />
  </svg>;
}
