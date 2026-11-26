import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { DuckShape } from "./Duck";

// Signal primitives. The lime "signal" (token: gold) is the single primary action per view; everything else is
// line / soft.

export type Tone = "gold" | "line" | "soft" | "danger";
const TONES: Record<Tone, string> = {
  gold: "bg-gold text-on-gold shadow-[0_0_0_1px_rgba(198,244,50,.35),0_10px_30px_-12px_rgba(198,244,50,.55)] hover:bg-gold-2 hover:shadow-[0_0_0_1px_rgba(219,255,110,.6),0_12px_36px_-10px_rgba(198,244,50,.75)]",
  line: "border-[#34406a] bg-[rgba(255,255,255,0.02)] text-fg hover:border-gold/60 hover:bg-gold/[.06]",
  soft: "bg-card-2 text-fg hover:bg-[#1c2338]",
  danger: "border-down/40 bg-down/10 text-down hover:bg-down/15",
};

const BTN =
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-transparent font-semibold tracking-[-0.005em] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const SIZES = {
  lg: "h-[52px] rounded-[11px] px-6 text-[15.5px]",
  md: "h-11 px-5 text-[14.5px]",
  sm: "h-9 px-4 text-[13.5px]",
};

export function Button({
  tone = "gold",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: keyof typeof SIZES }) {
  return <button type="button" className={`${BTN} ${TONES[tone]} ${SIZES[size]} ${className}`} {...rest} />;
}

export function ButtonLink({
  href,
  tone = "gold",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  tone?: Tone;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BTN} ${TONES[tone]} ${SIZES[size]} ${className}`}>
      {children}
    </Link>
  );
}

export type PanelTone = "card" | "raised" | "gold" | "down" | "flat";

export function Panel({
  children,
  className = "",
  tone = "card",
  shadow = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: PanelTone;
  /** featured: adds the gold hairline across the top edge */
  shadow?: boolean;
  id?: string;
}) {
  const bg = {
    card: "bg-card border-line",
    raised: "bg-card-2 border-line-2",
    gold: "bg-gold/5 border-gold/20",
    down: "bg-down/5 border-down/25",
    flat: "bg-surface border-line",
  }[tone];
  return (
    <div id={id} className={`min-w-0 rounded-2xl border p-5 sm:p-6 ${bg} ${shadow ? "gold-hairline hud" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Kicker({ children, className = "text-muted" }: { children: ReactNode; className?: string }) {
  return <div className={`inline-flex items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-[.16em] ${className}`}>{children}</div>;
}

export type PillTone = "neutral" | "gold" | "up" | "down" | "line";

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: PillTone; className?: string }) {
  const t = {
    neutral: "border-line-2 bg-card-2 text-sub",
    gold: "border-gold/45 bg-gold/[.06] text-gold",
    up: "border-up/40 bg-up/10 text-up",
    down: "border-down/40 bg-down/10 text-down",
    line: "border-line-2 text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] font-mono text-[10.5px] font-medium uppercase tracking-[.12em] ${t} ${className}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, className = "" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border border-line bg-card-2/70 px-4 py-3.5 ${className}`}>
      <div className="font-mono text-[11px] font-medium uppercase tracking-[.12em] text-muted">{label}</div>
      <div className="mt-1 break-words font-mono text-[22px] font-medium leading-tight tracking-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-[12.5px] text-dim">{sub}</div> : null}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-[13px] text-dim">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line-2 bg-card-2 px-4 py-3 font-mono text-[20px] font-medium text-fg placeholder:text-dim transition-colors hover:border-gold/50 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25";

export function Check({ ok, children }: { ok: boolean | undefined; children: ReactNode }) {
  const icon = ok === undefined ? "…" : ok ? "✓" : "✕";
  const color = ok === undefined ? "border-line-2 text-muted" : ok ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down";
  return (
    <li className="flex items-start gap-3 text-sub">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold ${color}`} aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Decorative pond motif for page headers: an agent duck afloat on its ripples (static SVG, aria-hidden). */
function HeaderPond() {
  return (
    <svg viewBox="0 0 420 230" className="pointer-events-none absolute -right-6 top-1/2 hidden h-[230px] w-[420px] -translate-y-1/2 md:block" aria-hidden="true">
      {[170, 128, 88, 52].map((rx, i) => (
        <ellipse key={rx} cx="250" cy="150" rx={rx} ry={rx * 0.34} fill="none" stroke={i % 2 ? "#1E2540" : "#262E46"} strokeDasharray={i % 2 ? "2 7" : undefined} />
      ))}
      <ellipse cx="120" cy="96" rx="4" ry="2.2" fill="#3E6B2E" opacity=".8" />
      <ellipse cx="368" cy="118" rx="3" ry="1.8" fill="#2B4A2E" opacity=".8" />
      <ellipse cx="330" cy="196" rx="4" ry="2.2" fill="#3E6B2E" opacity=".8" />
      <g transform="translate(206 92) scale(1.4)">
        <DuckShape tone="lime" />
      </g>
    </svg>
  );
}

/** Signal page header: system label, large title, lead. `art` renders behind on the right (decorative). */
export function PageHeader({
  kicker,
  sys,
  title,
  children,
  art,
  center = false,
}: {
  kicker?: ReactNode;
  /** Mono system label, e.g. "AGENT://EXCHANGE". */
  sys?: string;
  title: ReactNode;
  children?: ReactNode;
  art?: ReactNode;
  /** Centered, borderless header for single-card tool pages (swap). */
  center?: boolean;
}) {
  return (
    <section className={`relative overflow-hidden ${center ? "" : "border-b border-line"}`}>
      {art ?? (center ? null : <HeaderPond />)}
      <div className={`relative mx-auto max-w-[1200px] px-4 sm:px-8 ${center ? "pb-2 pt-10 text-center sm:pt-14" : "pb-8 pt-10 sm:pb-10 sm:pt-12"}`}>
        {sys ? (
          <div className={`sys-label mb-3 flex items-center gap-2 ${center ? "justify-center" : ""}`}>
            <span className="h-[7px] w-[7px] rotate-45 bg-gold" aria-hidden="true" />
            {sys}
          </div>
        ) : null}
        {kicker ? (
          <Kicker>
            <span className="live-dot" aria-hidden="true" />
            {kicker}
          </Kicker>
        ) : null}
        <h1
          className={`break-words leading-[1.1] ${kicker ? "mt-3" : ""} ${center ? "mx-auto max-w-[680px] text-[26px] sm:text-[32px]" : "max-w-[900px] text-[28px] sm:text-[34px] md:text-[40px]"}`}
        >
          {title}
        </h1>
        {children ? (
          <div className={`mt-3 text-[15.5px] leading-relaxed text-sub sm:text-[16.5px] ${center ? "mx-auto max-w-[520px]" : "max-w-[680px]"}`}>{children}</div>
        ) : null}
      </div>
    </section>
  );
}
