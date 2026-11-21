import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "candy" | "white" | "sun" | "sky" | "navy";
const TONES: Record<Tone, string> = {
  candy: "bg-candy text-white",
  white: "bg-white text-navy",
  sun: "bg-sun text-navy",
  sky: "bg-sky text-navy",
  navy: "bg-navy text-white",
};

const BTN =
  "press inline-flex items-center justify-center gap-2 rounded-full font-display font-extrabold border-4 border-navy shadow-[0_8px_0_#13204A] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-[0_4px_0_#13204A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun";

const SIZES = { lg: "text-[21px] px-10 py-5", md: "text-[17px] px-7 py-3.5", sm: "text-[14px] px-5 py-2.5 shadow-[0_5px_0_#13204A]" };

export function Button({
  tone = "candy",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: keyof typeof SIZES }) {
  return <button type="button" className={`${BTN} ${TONES[tone]} ${SIZES[size]} ${className}`} {...rest} />;
}

export function ButtonLink({
  href,
  tone = "candy",
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

export function Panel({
  children,
  className = "",
  tone = "white",
  shadow = true,
}: {
  children: ReactNode;
  className?: string;
  tone?: "white" | "candyPale" | "skyPale" | "sunPale" | "navy" | "ice";
  shadow?: boolean;
}) {
  const bg = {
    white: "bg-white",
    candyPale: "bg-candy-pale",
    skyPale: "bg-sky-pale",
    sunPale: "bg-sun-pale",
    navy: "bg-navy text-white",
    ice: "bg-ice",
  }[tone];
  return (
    <div className={`rounded-[36px] border-4 border-navy p-7 ${bg} ${shadow ? "shadow-[0_10px_0_#13204A]" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Kicker({ children, className = "text-candy" }: { children: ReactNode; className?: string }) {
  return <div className={`font-display font-extrabold text-[15px] uppercase tracking-[.25em] ${className}`}>{children}</div>;
}

export function Pill({
  children,
  tone = "navy",
  className = "",
}: {
  children: ReactNode;
  tone?: "navy" | "sun" | "sky" | "candy" | "white" | "ice";
  className?: string;
}) {
  const t = {
    navy: "bg-navy text-white",
    sun: "bg-sun text-navy",
    sky: "bg-sky text-navy",
    candy: "bg-candy text-white",
    white: "bg-white text-navy border-[3px] border-navy",
    ice: "bg-ice text-navy border-2 border-navy",
  }[tone];
  return <span className={`inline-flex items-center gap-2 rounded-full font-black text-xs px-3 py-1 ${t} ${className}`}>{children}</span>;
}

export function Stat({ label, value, sub, className = "" }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-ice border-[3px] border-navy px-5 py-4 ${className}`}>
      <div className="text-[13px] font-black uppercase tracking-widest text-navy/60">{label}</div>
      <div className="mt-1 font-display font-extrabold text-[26px] leading-tight break-words">{value}</div>
      {sub ? <div className="mt-0.5 text-sm font-bold text-navy/60">{sub}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-black uppercase tracking-widest text-navy/70">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-sm font-semibold text-navy/60">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border-[3px] border-navy bg-white px-4 py-3 font-display font-extrabold text-[20px] text-navy placeholder:text-navy/30 focus:outline-none focus:ring-4 focus:ring-sky";

export function Check({ ok, children }: { ok: boolean | undefined; children: ReactNode }) {
  const icon = ok === undefined ? "…" : ok ? "✓" : "✕";
  const color = ok === undefined ? "bg-ice text-navy" : ok ? "bg-sky text-navy" : "bg-candy text-white";
  return (
    <li className="flex items-start gap-3 font-bold">
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-[3px] border-navy text-sm font-black ${color}`} aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

export function PageHeader({
  kicker,
  title,
  children,
  tone = "sky",
  art,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
  tone?: "sky" | "candy" | "sun";
  art?: ReactNode;
}) {
  const bg = { sky: "bg-sky", candy: "bg-candy", sun: "bg-sun" }[tone];
  const text = tone === "sun" ? "text-navy" : "text-white";
  return (
    <section className="px-6 pt-4 pb-6">
      <div className={`relative mx-auto max-w-[1220px] overflow-hidden rounded-[48px] border-[6px] border-navy ${bg} px-8 py-12 shadow-[0_12px_0_#13204A] md:px-12`}>
        {art}
        <div className="relative">
          <div className="drop inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2 text-sm font-extrabold text-white">
            <span className="h-2 w-2 rounded-full bg-sun" />
            {kicker}
          </div>
          <h1
            className={`drop dl1 mt-5 font-display text-[44px] font-extrabold leading-[.95] md:text-[64px] ${text}`}
            style={{ textShadow: tone === "sun" ? undefined : "0 5px 0 #13204A" }}
          >
            {title}
          </h1>
          {children ? <div className="drop dl2 mt-5 max-w-[760px] text-[18px] font-bold leading-snug text-navy">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
