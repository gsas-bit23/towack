"use client";

import { animate, motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { PRIZES, SLICES, landingAngleIn, sliceIn, type Slice } from "@/lib/prizes";

/** What a slice needs to draw itself. Defaults to the paid Draw V1 deck. */
export type WheelPrize = { wheel: string; fill: string; ink: string };

/**
 * Atlas precision prize wheel (tick-marked bezel, restrained gold).
 *  - "attract": slow decorative drift (home page)
 *  - "idle": still
 *  - "spinning": anticipation spin (ramps up, runs until a prize arrives)
 *  - "land": eases out over a few seconds and stops exactly on `prizeId`
 *  - "landed": snaps to `prizeId` (returning visitor / reduced motion)
 * The landing angle is a pure function of (prizeId, salt), so it always matches the on-chain prize.
 */
export type WheelMode = "attract" | "idle" | "spinning" | "land" | "landed";

const C = 200; // centre in viewBox units
const R = 168; // slice radius
const MAX_SPEED = 880; // deg/s during anticipation
const LAND_SECONDS = 4.6;
const LAND_EASE: [number, number, number, number] = [0.12, 0.42, 0.22, 1]; // initial slope 3.5

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
}

function slicePath(start: number, end: number) {
  const [x1, y1] = polar(R, start);
  const [x2, y2] = polar(R, end);
  const large = end - start > 180 ? 1 : 0;
  return `M${C} ${C} L${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`;
}

/** Smallest rotation >= `from + minTravel` that puts `landing` under the top pointer. */
function targetRotation(from: number, minTravel: number, landing: number) {
  const t = from + minTravel;
  const adjust = (((-landing - t) % 360) + 360) % 360;
  return t + adjust;
}

export function SpinWheel({
  mode,
  prizeId,
  salt = 0,
  onLanded,
  className = "",
  size = 440,
  prizes = PRIZES,
  slices = SLICES,
}: {
  mode: WheelMode;
  prizeId?: number;
  salt?: number;
  onLanded?: () => void;
  className?: string;
  size?: number;
  prizes?: readonly WheelPrize[];
  slices?: readonly Slice[];
}) {
  const reduce = useReducedMotion();
  const rot = useMotionValue(0);
  const speed = useRef(0);
  const landedCb = useRef(onLanded);
  useEffect(() => {
    landedCb.current = onLanded;
  }, [onLanded]);

  // Continuous motion (attract drift / anticipation spin). No loop at all under reduced motion.
  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const dt = Math.min(delta, 64) / 1000;
    if (mode === "spinning") {
      speed.current = Math.min(MAX_SPEED, speed.current + 520 * dt);
      rot.set(rot.get() + speed.current * dt);
    } else if (mode === "attract") {
      rot.set(rot.get() + 10 * dt);
    }
  });

  useEffect(() => {
    if (mode !== "land" && mode !== "landed") {
      if (mode !== "spinning") speed.current = 0;
      return;
    }
    if (prizeId === undefined) return;
    const landing = landingAngleIn(slices, prizeId, salt);
    if (mode === "landed" || reduce) {
      rot.set(targetRotation(rot.get(), 0, landing));
      speed.current = 0;
      landedCb.current?.();
      return;
    }
    // Match the ease-out's initial velocity to the current spin so there is no visible jerk.
    const v = Math.max(speed.current, 360);
    const travel = Math.max(3 * 360, (v * LAND_SECONDS) / 3.5);
    const to = targetRotation(rot.get(), travel, landing);
    speed.current = 0;
    const controls = animate(rot, to, { duration: LAND_SECONDS, ease: LAND_EASE, onComplete: () => landedCb.current?.() });
    return () => controls.stop();
  }, [mode, prizeId, salt, reduce, rot, slices]);

  // Pointer flicks as each rim peg passes (pegs every 15°).
  const flick = useTransform(rot, (r) => {
    if (reduce) return 0;
    const phase = (((r % 15) + 15) % 15) / 15;
    return phase < 0.3 ? -16 * (1 - phase / 0.3) : 0;
  });

  const won = mode === "land" || mode === "landed" ? prizeId : undefined;
  const winSlice = won !== undefined ? sliceIn(slices, won) : undefined;

  return (
    // pt-[6%]: room for the needle, which pokes above the wheel square.
    <div className={`relative mx-auto select-none pt-[6%] ${className}`} style={{ width: "100%", maxWidth: size }} aria-hidden="true">
      {/* soft gold halo (opacity/transform only) */}
      <div className="wheel-glow pointer-events-none absolute inset-[4%] rounded-full" />
      <div className="relative aspect-square">
        {/* Static bezel: dark ring with degree ticks and numerals. */}
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
          <circle cx={C} cy={C} r={199} fill="#12161B" stroke="#2E353F" strokeWidth="1" />
          {BEZEL_TICKS.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.major ? "#4A525E" : "#2B3139"} strokeWidth={t.major ? 1.4 : 0.8} />
          ))}
          {BEZEL_NUMS.map((n) => (
            <text key={n.label} x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-plex-mono), monospace" fontSize="7.5" fill="#6B7380">
              {n.label}
            </text>
          ))}
        </svg>
        {/* Rotation lives inside the SVG so the spinning square's corners never widen the page. */}
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
          <motion.g style={{ rotate: rot, transformBox: "view-box", transformOrigin: "50% 50%" }}>
            <circle cx={C} cy={C} r={R + 4} fill="#0B0E11" />
            {slices.map((s) => {
              const p = prizes[s.id];
              const width = s.end - s.start;
              const fs = width < 16 ? 13 : width < 30 ? 14 : p.wheel.length > 5 ? 12 : 17;
              return (
                <g key={s.id}>
                  <path d={slicePath(s.start, s.end)} fill={p.fill} stroke="#0B0E11" strokeWidth="2" strokeLinejoin="round" />
                  {/* radial labels reading outward (the wheel rotates, so no fixed "upright" side exists) */}
                  <g transform={`rotate(${(s.mid - 90).toFixed(2)} ${C} ${C})`}>
                    <text
                      x={C + R - 16}
                      y={C}
                      textAnchor="end"
                      dominantBaseline="central"
                      fontFamily="var(--font-plex-mono), monospace"
                      fontWeight="500"
                      fontSize={fs}
                      fill={p.ink}
                    >
                      {p.wheel}
                    </text>
                  </g>
                </g>
              );
            })}
            {/* fine rim ticks that turn with the wheel */}
            {RIM_TICKS.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#0B0E11" strokeOpacity=".55" strokeWidth="1" />
            ))}
            {winSlice ? (
              <path
                d={slicePath(winSlice.start, winSlice.end)}
                fill="rgba(240,185,11,.10)"
                stroke="#FCD535"
                strokeWidth="3"
                strokeLinejoin="round"
                className={mode === "landed" || reduce ? "" : "win-flash"}
              />
            ) : null}
            <circle cx={C} cy={C} r={74} fill="#0B0E11" stroke="#232931" strokeWidth="1" />
            <circle cx={C} cy={C} r={62} fill="none" stroke="#232931" strokeDasharray="2 5" />
          </motion.g>
        </svg>

        {/* hub (does not rotate): Towack mark */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[24%] -translate-x-1/2 -translate-y-1/2">
          <svg viewBox="0 0 100 100" className="relative w-full">
            <circle cx="50" cy="50" r="46" fill="#161A20" stroke="#2E353F" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="30" fill="none" stroke="#2E353F" strokeWidth="5" />
            <path d="M50 20a30 30 0 0 1 26 45" fill="none" stroke="#F0B90B" strokeWidth="5" strokeLinecap="round" />
            <path d="M36.5 38h27v6.4H53.3V65h-6.4V44.4H36.5z" fill="#EAECEF" />
          </svg>
        </div>

        {/* pointer at 12 o'clock */}
        <motion.div className="absolute left-1/2 top-[-4%] w-[7%] -translate-x-1/2" style={{ rotate: flick, transformOrigin: "50% 20%" }}>
          <svg viewBox="0 0 30 46" className="w-full">
            <path d="M15 44 L3 6 Q15 0 27 6 Z" fill="#F0B90B" stroke="#0B0E11" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="15" cy="10" r="3" fill="#0B0E11" />
          </svg>
        </motion.div>
      </div>
    </div>
  );
}

function tick(r1: number, r2: number, deg: number) {
  const [x1, y1] = polar(r1, deg);
  const [x2, y2] = polar(r2, deg);
  return { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) };
}
const BEZEL_TICKS = Array.from({ length: 120 }, (_, i) => ({ ...tick(196, i % 10 === 0 ? 184 : 190, i * 3), major: i % 10 === 0 }));
const BEZEL_NUMS = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30;
  const [x, y] = polar(177.5, deg);
  return { label: String(deg).padStart(3, "0"), x: x.toFixed(2), y: y.toFixed(2) };
}).filter((n) => n.label !== "000");
const RIM_TICKS = Array.from({ length: 72 }, (_, i) => tick(R, R - (i % 6 === 0 ? 8 : 4), i * 5));
