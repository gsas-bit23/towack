"use client";

import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Slides/scales a section in once (transform-only: content is never left invisible) when it scrolls into view. Plain markup under reduced motion. */
export function Reveal({ children, className = "", delay = 0, y = 28 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ y, scale: 0.97 }}
      whileInView={{ y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Hero stage entrance: drops in with a little bounce. */
export function StageIn({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ scale: 0.94, y: 30 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 16, mass: 0.9 }}
    >
      {children}
    </motion.div>
  );
}

/** Counts up/down to `value` whenever it changes (starts from 0 the first time it is seen). */
export function AnimatedNumber({ value, className = "" }: { value: number | undefined; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || value === undefined) return;
    if (reduce) {
      el.textContent = value.toLocaleString("en-US");
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: Math.min(1.6, 0.5 + Math.abs(value - prev.current) / 400),
      ease: "easeOut",
      onUpdate: (v) => {
        el.textContent = Math.round(v).toLocaleString("en-US");
      },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {value === undefined ? "—" : "0"}
    </span>
  );
}

/** Animated progress bar fill. */
export function ProgressFill({ pct, className = "" }: { pct: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`h-full ${className}`}
      initial={{ width: 0 }}
      animate={{ width: `${pct}%` }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 18 }}
    />
  );
}

/** Coin-stack column that grows in, coin by coin, once visible (tokenomics chart). */
export function CoinColumn({ count, color, label, index }: { count: number; color: string; label: string; index: number }) {
  const reduce = useReducedMotion();
  const coin = { hidden: { scale: 0, y: -40 }, shown: { scale: 1, y: 0 } };
  return (
    <motion.div
      className="flex h-full flex-col-reverse items-center"
      initial={reduce ? false : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delayChildren: index * 0.07, staggerChildren: 0.045 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          variants={coin}
          className="-mt-0.5 h-4 w-[84%] rounded-full border-[3px] border-navy"
          style={{ background: color }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
        />
      ))}
      <motion.div variants={{ hidden: { scale: 0 }, shown: { scale: 1 } }} className="mb-2 font-display text-[28px] font-extrabold">
        {label}
      </motion.div>
    </motion.div>
  );
}

const CONFETTI_COLORS = ["#FF4FA3", "#1FC6F2", "#FFCD2E", "#13204A", "#FFFFFF"];

/** One-shot confetti burst. `fire` changes -> new burst. Nothing at all under reduced motion. */
export function Confetti({ fire, big = false }: { fire: number; big?: boolean }) {
  const reduce = useReducedMotion();
  const [doneFor, setDoneFor] = useState(0);
  const active = fire && doneFor !== fire ? fire : 0;
  useEffect(() => {
    if (!fire) return;
    const t = setTimeout(() => setDoneFor(fire), 2600);
    return () => clearTimeout(t);
  }, [fire]);
  const pieces = useMemo(() => {
    if (!active) return [];
    const n = big ? 90 : 36;
    // Seeded by `active` so a re-render does not reshuffle mid-flight.
    let s = active * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: n }, (_, i) => {
      const ang = rnd() * Math.PI * 2;
      const dist = (big ? 220 : 150) + rnd() * (big ? 260 : 140);
      return {
        i,
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist - 80,
        r: rnd() * 720 - 360,
        w: 8 + rnd() * 8,
        h: 10 + rnd() * 12,
        c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        d: 1.4 + rnd() * 0.9,
        round: rnd() > 0.7,
      };
    });
  }, [active, big]);
  if (reduce || !active) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[42%] z-20 h-0 w-0" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={`${active}-${p.i}`}
          className="absolute block border-2 border-navy"
          style={{ width: p.w, height: p.round ? p.w : p.h, background: p.c, borderRadius: p.round ? 999 : 3 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 160], rotate: p.r, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: p.d, ease: "easeOut", times: [0, 0.55, 1] }}
        />
      ))}
    </div>
  );
}
