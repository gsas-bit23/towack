// Towack's "agent duck" (Towack ~ quack): an original, geometric side-view duck with a little antenna, drawn as plain
// SVG so it can sit inside other SVGs (<Duck as="g" />) or stand alone. Decorative unless given a title.

export type DuckTone = "lime" | "ion" | "cream";

const TONES: Record<DuckTone, { body: string; wing: string; head: string; ring: string }> = {
  lime: { body: "#C6F432", wing: "#9CCB1F", head: "#2FE3A0", ring: "#0A0C15" },
  ion: { body: "#8B7CFF", wing: "#6F60E8", head: "#B4AAFF", ring: "#0A0C15" },
  cream: { body: "#EEF1F8", wing: "#C9D0E2", head: "#2FE3A0", ring: "#0A0C15" },
};

/**
 * Shape is drawn in a 64x52 box, facing right. `flip` mirrors it to face left.
 * `antenna` adds the agent antenna; `bob` lets CSS animate a gentle float (class `duck-bob`).
 */
export function DuckShape({ tone = "lime", flip = false, antenna = true }: { tone?: DuckTone; flip?: boolean; antenna?: boolean }) {
  const c = TONES[tone];
  return (
    <g transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
      {/* water shadow */}
      <ellipse cx="30" cy="48" rx="24" ry="2.6" fill="#000" opacity=".35" />
      {/* body + tail */}
      <path d="M6 30 C2 24 5 19 9 21 L13 23 C17 20 24 19 31 20 L38 21 C46 22 52 27 52 34 C52 42 44 46 32 46 C18 46 8 42 6 30 Z" fill={c.body} />
      {/* wing */}
      <path d="M22 30 C27 26 37 26 42 31 C38 37 29 38 22 34 Z" fill={c.wing} />
      {/* neck + head */}
      <path d="M36 23 C36 15 39 9 45 8 C52 7 57 11 57 17 C57 22 54 25 50 26 L44 27 C40 27 37 26 36 23 Z" fill={c.head} />
      {/* bill (beak orange) */}
      <path d="M55 15 C59 14.5 63 15.5 63.5 17.5 C63 19.5 59 20 55 19.5 Z" fill="#FF9F43" />
      {/* eye */}
      <circle cx="49.5" cy="14" r="2.4" fill={c.ring} />
      <circle cx="50.2" cy="13.3" r=".8" fill="#fff" />
      {/* collar ring (the "agent" band) */}
      <path d="M37.5 24.5 C41 26.5 46 26.6 50 25.6" stroke="#EEF1F8" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".85" />
      {antenna ? (
        <g>
          <path d="M45 8.5 C44 5 45 2.5 47.5 1.5" stroke="#EEF1F8" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <circle cx="48" cy="1.6" r="1.8" fill="#C6F432" />
        </g>
      ) : null}
    </g>
  );
}

/** Standalone duck icon. */
export function Duck({ size = 32, tone = "lime", flip = false, antenna = true, className = "", title }: { size?: number; tone?: DuckTone; flip?: boolean; antenna?: boolean; className?: string; title?: string }) {
  return (
    <svg width={size} height={(size * 52) / 64} viewBox="0 0 64 52" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <DuckShape tone={tone} flip={flip} antenna={antenna} />
    </svg>
  );
}
