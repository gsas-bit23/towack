// Atlas illustration pieces (pure SVG, decorative, aria-hidden).

/** Towack mark: a ring with a gold arc and a T. */
export function CoinMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="none" stroke="#2E353F" strokeWidth="2.5" />
      <path d="M14 2a12 12 0 0 1 10.4 18" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M8.5 9h11v2.6h-4.2V20h-2.6v-8.4H8.5z" fill="#EAECEF" />
    </svg>
  );
}

const C = 280;
function pt(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
}
function arc(r: number, from: number, to: number) {
  const [x1, y1] = pt(r, from);
  const [x2, y2] = pt(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const TICKS = Array.from({ length: 120 }, (_, i) => {
  const deg = i * 3;
  const major = i % 15 === 0;
  const [x1, y1] = pt(270, deg);
  const [x2, y2] = pt(major ? 254 : 264, deg);
  return { x1, y1, x2, y2, major };
});

/**
 * Hero instrument: tick ring + gold progress arc. `progress` (0..1) sets the gold sweep (e.g. slots minted / 5,000);
 * the ring itself drifts very slowly (CSS, removed under reduced motion).
 */
export function InstrumentArc({ progress = 0.62, className = "" }: { progress?: number; className?: string }) {
  const p = Math.max(0.02, Math.min(0.999, progress));
  const start = 215;
  const sweep = 290;
  const end = start + sweep * p;
  const [kx, ky] = pt(218, end % 360);
  return (
    <svg viewBox="0 0 560 560" className={className} aria-hidden="true">
      <g className="arc-spin">
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x1.toFixed(2)}
            y1={t.y1.toFixed(2)}
            x2={t.x2.toFixed(2)}
            y2={t.y2.toFixed(2)}
            stroke={t.major ? "#3A414B" : "#20262D"}
            strokeWidth={t.major ? 1.6 : 1}
          />
        ))}
      </g>
      <path d={arc(218, start, start + sweep)} fill="none" stroke="#2B3139" strokeWidth="6" strokeLinecap="round" />
      <path d={arc(218, start, end)} fill="none" stroke="#F0B90B" strokeWidth="6" strokeLinecap="round" opacity=".9" />
      <circle cx={C} cy={C} r="160" fill="none" stroke="#1E2329" />
      <circle cx={C} cy={C} r="110" fill="none" stroke="#1E2329" strokeDasharray="2 6" />
      <circle cx={kx.toFixed(2)} cy={ky.toFixed(2)} r="6" fill="#0B0E11" stroke="#F0B90B" strokeWidth="2" />
    </svg>
  );
}

/** Thin chevron used between flow steps. */
export function Arrow() {
  return (
    <svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true" className="shrink-0 text-line-2">
      <path d="M2 8 H34 M28 3 L35 8 L28 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Line icons (24px grid, currentColor) */
const ICONS = {
  launch: "M12 3c3.2 2 4.6 5.1 4.6 8.7L14.4 15H9.6l-2.2-3.3C7.4 8.1 8.8 5 12 3Z M9.6 15 8 19.5l2.6-.8L12 21l1.4-2.3 2.6.8-1.6-4.5",
  swap: "M4 8h14l-3.5-3.5M20 16H6l3.5 3.5",
  perps: "M4 18 9.5 12l3.5 3.5L20 8M15 8h5v5",
  rebate: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4 M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z m-3 9 2.2 2.2L15.5 10",
  id: "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h2.5",
  ticket: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z M14 7v10",
  book: "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M17 20h2V6",
} as const;

export type IconName = keyof typeof ICONS | "draw";

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  if (name === "draw") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
