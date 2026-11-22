"use client";

import { animate, motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { PRIZES, SLICES, landingAngleIn, sliceIn, type Slice } from "@/lib/prizes";

/** What a slice needs to draw itself. Defaults to the paid Draw V1 deck. */
export type WheelPrize = { wheel: string; fill: string; ink: string };

/**
 * Carnival prize wheel.
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
      {/* stage glow */}
      <div className="wheel-glow pointer-events-none absolute inset-[6%] rounded-full" />
      <div className="relative aspect-square">
        {/* Rotation lives inside the SVG so the spinning square's corners never widen the page. */}
        <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full drop-shadow-[0_10px_0_#13204A]">
          <motion.g style={{ rotate: rot, transformBox: "view-box", transformOrigin: "50% 50%" }}>
            <circle cx={C} cy={C} r={196} fill="#13204A" />
            <circle cx={C} cy={C} r={186} fill="#FF4FA3" stroke="#13204A" strokeWidth="4" />
            {slices.map((s) => {
              const p = prizes[s.id];
              const width = s.end - s.start;
              const fs = width < 16 ? 17 : width < 30 ? 18 : p.wheel.length > 5 ? 15 : 24;
              return (
                <g key={s.id}>
                  <path d={slicePath(s.start, s.end)} fill={p.fill} stroke="#13204A" strokeWidth="4" strokeLinejoin="round" />
                  {/* radial labels reading outward (the wheel rotates, so no fixed "upright" side exists) */}
                  <g transform={`rotate(${(s.mid - 90).toFixed(2)} ${C} ${C})`}>
                    <text
                      x={C + R - 14}
                      y={C}
                      textAnchor="end"
                      dominantBaseline="central"
                      fontFamily="var(--font-sora), Sora"
                      fontWeight="800"
                      fontSize={fs}
                      fill={p.ink}
                    >
                      {p.wheel}
                    </text>
                  </g>
                </g>
              );
            })}
            {winSlice ? (
              <path
                d={slicePath(winSlice.start, winSlice.end)}
                fill="none"
                stroke="#FFCD2E"
                strokeWidth="9"
                strokeLinejoin="round"
                className={mode === "landed" || reduce ? "" : "win-flash"}
              />
            ) : null}
            {/* rim pegs / bulbs */}
            {Array.from({ length: 24 }, (_, i) => {
              const [x, y] = polar(178, i * 15);
              return <circle key={i} cx={x} cy={y} r={4.5} fill={i % 2 ? "#FFFFFF" : "#FFCD2E"} stroke="#13204A" strokeWidth="2" className="bulb" />;
            })}
          </motion.g>
        </svg>

        {/* hub (does not rotate): lit TW coin */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[22%] -translate-x-1/2 -translate-y-1/2">
          <div className="hub-glow absolute -inset-[30%] rounded-full" />
          <svg viewBox="0 0 100 100" className="relative w-full">
            <circle cx="50" cy="54" r="44" fill="#E6AE00" stroke="#13204A" strokeWidth="6" />
            <circle cx="50" cy="48" r="44" fill="#FFCD2E" stroke="#13204A" strokeWidth="6" />
            <circle cx="50" cy="48" r="32" fill="none" stroke="#13204A" strokeWidth="3" strokeDasharray="4 4" />
            <text x="50" y="60" textAnchor="middle" fontFamily="var(--font-sora), Sora" fontWeight="800" fontSize="32" fill="#13204A">
              TW
            </text>
          </svg>
        </div>

        {/* pointer at 12 o'clock */}
        <motion.div className="absolute left-1/2 top-[-5%] w-[13%] -translate-x-1/2" style={{ rotate: flick, transformOrigin: "50% 30%" }}>
          <svg viewBox="0 0 60 76" className="w-full drop-shadow-[0_5px_0_#13204A]">
            <path d="M30 72 L6 22 A26 26 0 1 1 54 22 Z" fill="#FF4FA3" stroke="#13204A" strokeWidth="5" strokeLinejoin="round" />
            <circle cx="30" cy="24" r="9" fill="#FFCD2E" stroke="#13204A" strokeWidth="4" />
          </svg>
        </motion.div>
      </div>
      {/* booth stand */}
      <div className="mx-auto -mt-[2%] h-[46px] w-[18%] rounded-b-xl border-x-4 border-b-4 border-navy bg-sky" />
      <div className="mx-auto h-[18px] w-[46%] rounded-full border-4 border-navy bg-sun" />
    </div>
  );
}
