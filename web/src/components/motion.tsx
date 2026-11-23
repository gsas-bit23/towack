"use client";

import { animate, motion, useReducedMotion, type Variants } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Atlas motion kit. Rules: transform + opacity only, short springs, nothing invisible if JS never runs,
// and an instant final state under prefers-reduced-motion.

const EASE_OUT: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
const SPRING = { type: "spring", stiffness: 260, damping: 28, mass: 0.8 } as const;

/**
 * Route-change transition: a subtle fade + 8px rise. The very first page load renders with no initial
 * state (server HTML is final), so content never depends on JS to become visible.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [firstPath] = useState(pathname);
  const [moved, setMoved] = useState(false);
  if (!moved && pathname !== firstPath) setMoved(true);
  const animateIn = moved && !reduce;
  return (
    <motion.div
      key={pathname}
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Rises a section in once when it scrolls into view. Starts at 50% opacity, so it is readable even if the observer never fires. */
export function Reveal({ children, className = "", delay = 0, y = 18 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ y, opacity: 0.5 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ ...SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

const staggerParent: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } } };
const staggerChild: Variants = { hidden: { y: 16, opacity: 0.5 }, shown: { y: 0, opacity: 1, transition: SPRING } };

/** Container whose <StaggerItem> children reveal one after another when scrolled into view. */
export function Stagger({ children, className = "", as = "div" }: { children: ReactNode; className?: string; as?: "div" | "ul" }) {
  const reduce = useReducedMotion();
  const Comp = as === "ul" ? motion.ul : motion.div;
  if (reduce) return as === "ul" ? <ul className={className}>{children}</ul> : <div className={className}>{children}</div>;
  return (
    <Comp className={className} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.1 }} variants={staggerParent}>
      {children}
    </Comp>
  );
}

export function StaggerItem({ children, className = "", as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" }) {
  const reduce = useReducedMotion();
  if (reduce) return as === "li" ? <li className={className}>{children}</li> : <div className={className}>{children}</div>;
  const Comp = as === "li" ? motion.li : motion.div;
  return (
    <Comp className={className} variants={staggerChild}>
      {children}
    </Comp>
  );
}

/** Hero entrance: a short rise on first paint (transform only, so SSR content is fully visible). */
export function StageIn({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ y: 14 }} animate={{ y: 0 }} transition={{ ...SPRING, delay }}>
      {children}
    </motion.div>
  );
}

export type NumberFormat = {
  /** fixed decimals shown while counting and at rest (default 0) */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** compact notation (1.2M, 70M) */
  compact?: boolean;
};

export function formatTicker(v: number, { decimals = 0, prefix = "", suffix = "", compact = false }: NumberFormat = {}) {
  const body = compact
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: decimals }).format(v)
    : v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${prefix}${body}${suffix}`;
}

/**
 * Counts to `value` whenever it changes (from 0 the first time). Supports decimals, prefix/suffix and compact notation.
 * SSR renders the final value, so the number is correct without JS; live reads that resolve after mount count up.
 */
export function AnimatedNumber({
  value,
  className = "",
  decimals = 0,
  prefix = "",
  suffix = "",
  compact = false,
  placeholder = "—",
}: { value: number | undefined; className?: string; placeholder?: string } & NumberFormat) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  // Values known at first render (static/SSR) are shown as-is; values that arrive later (hook reads) count up from 0.
  const prev = useRef<number | null>(value ?? null);
  const fmt = useMemo(() => ({ decimals, prefix, suffix, compact }), [decimals, prefix, suffix, compact]);
  useEffect(() => {
    const el = ref.current;
    if (!el || value === undefined) return;
    const from = prev.current ?? 0;
    prev.current = value;
    if (reduce || from === value) {
      el.textContent = formatTicker(value, fmt);
      return;
    }
    const span = Math.abs(value - from);
    const controls = animate(from, value, {
      duration: Math.min(1.4, 0.45 + Math.log10(1 + span) / 6),
      ease: EASE_OUT,
      onUpdate: (v) => {
        el.textContent = formatTicker(v, fmt);
      },
    });
    return () => controls.stop();
  }, [value, reduce, fmt]);
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {value === undefined ? placeholder : formatTicker(value, fmt)}
    </span>
  );
}

/** Progress fill: animates scaleX (origin left) instead of width, so it never triggers layout. Parent sets the track size. */
export function ProgressFill({ pct, className = "" }: { pct: number; className?: string }) {
  const reduce = useReducedMotion();
  const scale = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <motion.div
      className={`h-full w-full origin-left ${className}`}
      initial={reduce ? false : { scaleX: 0 }}
      animate={{ scaleX: scale }}
      style={reduce ? { scaleX: scale } : undefined}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 70, damping: 20 }}
    />
  );
}

/** Shimmer skeleton block for wallet/contract reads. Reserve the final size with className (h-/w-). */
export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  if (!label) return <span aria-hidden="true" className={`skeleton block ${className}`} />;
  return <span role="status" aria-label={label} className={`skeleton block ${className}`} />;
}

/**
 * Tokenomics column: a thin stack of segments that settles into place once visible.
 * Transform-only, never scale 0: segments and labels are readable even if the observer never fires.
 */
export function CoinColumn({ count, color, label, index }: { count: number; color: string; label: string; index: number }) {
  const reduce = useReducedMotion();
  const seg = { hidden: { scaleX: 0.6, y: -6 }, shown: { scaleX: 1, y: 0 } };
  return (
    <motion.div
      className="flex h-full flex-col-reverse items-center"
      initial={reduce ? false : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delayChildren: index * 0.05, staggerChildren: 0.03 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          variants={seg}
          className="mt-[3px] h-3 w-[78%] rounded-[3px]"
          style={{ background: color }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
        />
      ))}
      <motion.div variants={{ hidden: { y: 4 }, shown: { y: 0 } }} className="mb-2 font-mono text-[22px] font-medium tracking-tight">
        {label}
      </motion.div>
    </motion.div>
  );
}

/**
 * Refined success burst: a soft gold flash, an expanding hairline ring and a few gold sparks.
 * `fire` changes -> new burst. Nothing at all under reduced motion. (Kept as `Confetti` for existing call sites.)
 */
export function Confetti({ fire, big = false }: { fire: number; big?: boolean }) {
  const reduce = useReducedMotion();
  const [doneFor, setDoneFor] = useState(0);
  const active = fire && doneFor !== fire ? fire : 0;
  useEffect(() => {
    if (!fire) return;
    const t = setTimeout(() => setDoneFor(fire), 1800);
    return () => clearTimeout(t);
  }, [fire]);
  const sparks = useMemo(() => {
    if (!active) return [];
    const n = big ? 18 : 12;
    let s = active * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2 + rnd() * 0.3;
      const dist = (big ? 150 : 110) + rnd() * 50;
      return { i, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, d: 0.9 + rnd() * 0.4, s: 3 + rnd() * 3 };
    });
  }, [active, big]);
  if (reduce || !active) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[42%] z-20 h-0 w-0" aria-hidden="true">
      <motion.span
        key={`f-${active}`}
        className="absolute -left-[160px] -top-[160px] block h-[320px] w-[320px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(240,185,11,.35), rgba(240,185,11,0))" }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 1, 0], scale: [0.6, 1, 1.15] }}
        transition={{ duration: 1.1, ease: "easeOut", times: [0, 0.3, 1] }}
      />
      <motion.span
        key={`r-${active}`}
        className="absolute -left-[60px] -top-[60px] block h-[120px] w-[120px] rounded-full border border-gold"
        initial={{ opacity: 0.9, scale: 0.4 }}
        animate={{ opacity: 0, scale: big ? 2.6 : 2 }}
        transition={{ duration: 1, ease: EASE_OUT }}
      />
      {sparks.map((p) => (
        <motion.span
          key={`${active}-${p.i}`}
          className="absolute block rounded-full bg-gold-2"
          style={{ width: p.s, height: p.s }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: p.d, ease: EASE_OUT }}
        />
      ))}
    </div>
  );
}

/** Animated check mark for mint/claim success (draws its stroke; static under reduced motion). */
export function SuccessCheck({ className = "h-10 w-10" }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
      initial={reduce ? false : { scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
    >
      <circle cx="20" cy="20" r="19" fill="rgba(240,185,11,.12)" stroke="#F0B90B" strokeWidth="1.5" />
      <motion.path
        d="M12 20.5 18 26 28.5 14.5"
        fill="none"
        stroke="#F0B90B"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.12, ease: EASE_OUT }}
      />
    </motion.svg>
  );
}
