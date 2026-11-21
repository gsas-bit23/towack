// Arcade Sky illustration pieces (pure SVG, decorative, aria-hidden).
import type { CSSProperties } from "react";

export function CoinMark({ size = 46, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="26" r="20" fill="#E6AE00" />
      <circle cx="24" cy="22" r="20" fill="#FFCD2E" />
      <circle cx="24" cy="22" r="14.5" fill="none" stroke="#13204A" strokeWidth="2.5" strokeDasharray="3 3" />
      <text x="24" y="27.5" textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="14" fill="#13204A">
        TW
      </text>
    </svg>
  );
}

export function Bulbs({ count = 20 }: { count?: number }) {
  return (
    <div className="absolute inset-x-10 top-5 flex justify-between" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`bulb w-3.5 h-3.5 rounded-full ${i % 2 ? "bg-white" : "bg-sun"}`} />
      ))}
    </div>
  );
}

const RAYS = [
  "M100 100 L100 0 L112 0Z", "M100 100 L170.7 29.3 L179.2 37.8Z", "M100 100 L200 100 L200 112Z",
  "M100 100 L170.7 170.7 L162.2 179.2Z", "M100 100 L100 200 L88 200Z", "M100 100 L29.3 170.7 L20.8 162.2Z",
  "M100 100 L0 100 L0 88Z", "M100 100 L29.3 29.3 L37.8 20.8Z", "M100 100 L138.3 7.6 L149.2 12.2Z",
  "M100 100 L192.4 138.3 L187.8 149.2Z", "M100 100 L61.7 192.4 L50.8 187.8Z", "M100 100 L7.6 61.7 L12.2 50.8Z",
  "M100 100 L192.4 61.7 L195.8 73Z", "M100 100 L138.3 192.4 L127 195.8Z", "M100 100 L7.6 138.3 L4.2 127Z",
  "M100 100 L61.7 7.6 L73 4.2Z",
];

export function Sunburst({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1400px] max-w-none opacity-[.18] ${className}`}
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <g fill="#fff">
        {RAYS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function CoinStack({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 160 200" aria-hidden="true">
      <g stroke="#13204A" strokeWidth="5">
        <ellipse cx="80" cy="176" rx="64" ry="18" fill="#E6AE00" />
        <rect x="16" y="150" width="128" height="26" fill="#E6AE00" stroke="none" />
        <path d="M16 150 V176 M144 150 V176" />
        <ellipse cx="80" cy="150" rx="64" ry="18" fill="#FFCD2E" />
        <ellipse cx="80" cy="132" rx="64" ry="18" fill="#E6AE00" />
        <rect x="16" y="106" width="128" height="26" fill="#E6AE00" stroke="none" />
        <path d="M16 106 V132 M144 106 V132" />
        <ellipse cx="80" cy="106" rx="64" ry="18" fill="#FFCD2E" />
        <ellipse cx="80" cy="88" rx="64" ry="18" fill="#E6AE00" />
        <rect x="16" y="62" width="128" height="26" fill="#E6AE00" stroke="none" />
        <path d="M16 62 V88 M144 62 V88" />
        <ellipse cx="80" cy="62" rx="64" ry="18" fill="#FFCD2E" />
      </g>
      <text x="80" y="68" textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="18" fill="#13204A">
        TWAK
      </text>
    </svg>
  );
}

export function StarCoin({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true">
      <g className="coin-spin">
        <circle cx="50" cy="54" r="42" fill="#E6AE00" stroke="#13204A" strokeWidth="5" />
        <circle cx="50" cy="48" r="42" fill="#FFCD2E" stroke="#13204A" strokeWidth="5" />
        <path
          d="M50 26 l6 14 15 2 -11 10 3 15 -13 -8 -13 8 3 -15 -11 -10 15 -2z"
          fill="#FF4FA3"
          stroke="#13204A"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function TwCoin({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="54" r="42" fill="#E6AE00" stroke="#13204A" strokeWidth="5" />
      <circle cx="50" cy="48" r="42" fill="#FFCD2E" stroke="#13204A" strokeWidth="5" />
      <text x="50" y="60" textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="30" fill="#13204A">
        TW
      </text>
    </svg>
  );
}

const TICKET_PATH =
  "M14 6 H226 a8 8 0 0 1 8 8 V40 a15 15 0 0 0 0 30 V96 a8 8 0 0 1 -8 8 H14 a8 8 0 0 1 -8 -8 V70 a15 15 0 0 0 0 -30 V14 a8 8 0 0 1 8 -8Z";

export function AdmitTicket({ className = "", style, serial = "0427" }: { className?: string; style?: CSSProperties; serial?: string }) {
  return (
    <svg className={className} style={style} viewBox="0 0 240 110" aria-hidden="true">
      <path d={TICKET_PATH} fill="#FF4FA3" stroke="#13204A" strokeWidth="5" />
      <line x1="172" y1="14" x2="172" y2="96" stroke="#13204A" strokeWidth="4" strokeDasharray="6 7" />
      <text x="30" y="52" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="16" fill="#fff">ADMIT ONE</text>
      <text x="30" y="84" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="26" fill="#13204A">AGENT ID</text>
      <text x="203" y="62" textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="20" fill="#fff" transform="rotate(-90 203 56)">
        {serial}
      </text>
    </svg>
  );
}

export function LabelTicket({
  label,
  className = "",
  style,
  fill = "#FFCD2E",
  fontSize = 36,
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  fill?: string;
  fontSize?: number;
}) {
  return (
    <svg className={className} style={style} viewBox="0 0 240 110" aria-hidden="true">
      <path d={TICKET_PATH} fill={fill} stroke="#13204A" strokeWidth="6" />
      <text x="120" y={56 + fontSize * 0.38} textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize={fontSize} fill="#13204A">
        {label}
      </text>
    </svg>
  );
}

export function Arrow() {
  return (
    <svg width="70" height="30" viewBox="0 0 70 30" aria-hidden="true" className="shrink-0">
      <path d="M2 15 H58 M48 4 L64 15 L48 26" stroke="#13204A" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
