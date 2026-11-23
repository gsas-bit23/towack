import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// Atlas primitives. Gold is the single primary action per view; everything else is line / soft.

export type Tone = "gold" | "line" | "soft" | "danger";
const TONES: Record<Tone, string> = {
  gold: "bg-gold text-on-gold hover:bg-gold-2 hover:shadow-[0_8px_24px_-10px_rgba(240,185,11,.65)]",
  line: "border-line-2 bg-transparent text-fg hover:border-[#4A525E] hover:bg-card",
  soft: "bg-card-2 text-fg hover:bg-[#262C34]",
  danger: "border-down/40 bg-down/10 text-down hover:bg-down/15",
};

const BTN =
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-transparent font-semibold disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const SIZES = {
  lg: "h-[52px] rounded-xl px-6 text-[15.5px]",
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
}: {
  children: ReactNode;
  className?: string;
  tone?: PanelTone;
  /** featured: adds the gold hairline across the top edge */
  shadow?: boolean;
}) {
  const bg = {
    card: "bg-card border-line",
    raised: "bg-card-2 border-line-2",
    gold: "bg-gold/5 border-gold/20",
    down: "bg-down/5 border-down/25",
    flat: "bg-surface border-line",
  }[tone];
  return <div className={`min-w-0 rounded-2xl border p-5 sm:p-6 ${bg} ${shadow ? "gold-hairline" : ""} ${className}`}>{children}</div>;
}

export function Kicker({ children, className = "text-muted" }: { children: ReactNode; className?: string }) {
  return <div className={`inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.12em] ${className}`}>{children}</div>;
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
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-semibold uppercase tracking-[.08em] ${t} ${className}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, className = "" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl bg-card-2 px-4 py-3.5 ${className}`}>
      <div className="text-[12.5px] font-medium text-muted">{label}</div>
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

/** Atlas page header: eyebrow, large title, lead. `art` renders behind on the right (decorative). */
export function PageHeader({ kicker, title, children, art }: { kicker: ReactNode; title: ReactNode; children?: ReactNode; art?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      {art}
      <div className="relative mx-auto max-w-[1200px] px-4 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-12">
        <Kicker>
          <span className="live-dot" aria-hidden="true" />
          {kicker}
        </Kicker>
        <h1 className="mt-3 max-w-[860px] break-words text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px] md:text-[44px]">{title}</h1>
        {children ? <div className="mt-3 max-w-[680px] text-[15.5px] leading-relaxed text-sub sm:text-[16.5px]">{children}</div> : null}
      </div>
    </section>
  );
}
