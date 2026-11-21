"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Spin } from "@/lib/draw";
import { shortAddr } from "@/lib/format";
import { DECK_SIZE, PRIZES, prizeById, shareText } from "@/lib/prizes";
import { useNow } from "@/lib/useNow";
import { Confetti } from "./motion";
import { SpinWheel, type WheelMode } from "./SpinWheel";
import { Button, Pill } from "./ui";

export type WheelStatus = "none" | "waiting" | "assigned";

/**
 * Wheel + result card. Drives the wheel from on-chain state only:
 *  waiting  -> anticipation spin until PrizeAssigned shows up
 *  assigned -> ease out and stop exactly on prizeId (or snap there if the visitor arrives later)
 */
export function WheelStage({
  status,
  prizeId,
  salt = 0,
  fresh = false,
  demo = false,
  waitingNote,
  actions,
  idleNote,
  size = 460,
}: {
  status: WheelStatus;
  prizeId?: number;
  salt?: number;
  fresh?: boolean;
  demo?: boolean;
  waitingNote?: ReactNode;
  actions?: ReactNode;
  idleNote?: ReactNode;
  size?: number;
}) {
  const [mode, setMode] = useState<WheelMode>(status === "none" ? "attract" : status === "waiting" || fresh ? "spinning" : "landed");
  const [landed, setLanded] = useState(false);
  const [burst, setBurst] = useState(0);
  const [prevStatus, setPrevStatus] = useState(status);

  // Status transitions (adjusting state during render on prop change, per React docs).
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "waiting") {
      setLanded(false);
      setMode("spinning");
    } else if (status === "assigned") {
      if (mode !== "spinning") setMode(fresh ? "spinning" : "landed");
    } else {
      setLanded(false);
      setMode("attract");
    }
  }

  // Prize known while spinning: let the anticipation breathe briefly, then ease out onto it.
  useEffect(() => {
    if (status !== "assigned" || mode !== "spinning") return;
    const t = setTimeout(() => setMode("land"), 1200);
    return () => clearTimeout(t);
  }, [status, mode]);

  const onLanded = useCallback(() => {
    setLanded(true);
    if (mode === "land" && prizeId !== undefined && prizeId !== 10) setBurst((b) => b + 1);
  }, [mode, prizeId]);

  const prize = prizeById(prizeId);
  const showResult = landed && prize !== undefined && status === "assigned";

  return (
    <div className="relative">
      {demo ? (
        <div className="mb-4 flex justify-center">
          <Pill tone="sun" className="border-[3px] border-navy text-[13px]">
            DEMO SPIN · not a real mint or prize
          </Pill>
        </div>
      ) : null}
      {/* Confetti gets its own clipped layer (just inside the panel) so the wheel stage itself never clips the needle or result card. */}
      <div className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 overflow-hidden rounded-[28px]" aria-hidden="true">
        <Confetti fire={burst} big={Boolean(prize?.jackpot)} />
      </div>
      <SpinWheel mode={mode} prizeId={prizeId} salt={salt} onLanded={onLanded} size={size} />

      <div className="mt-6 min-h-[120px]" aria-live="polite">
        {status === "waiting" || (status === "assigned" && !landed) ? (
          <div className="text-center">
            <div className="font-display text-[26px] font-extrabold">{status === "waiting" ? "Spinning… waiting for Chainlink VRF" : "Here it comes…"}</div>
            {waitingNote ? <div className="mt-2 font-bold text-navy/70">{waitingNote}</div> : null}
          </div>
        ) : showResult ? (
          <motion.div
            initial={{ y: 18, scale: 0.9 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            className={`stub rounded-[28px] px-6 py-5 text-center ${prize.kind === "none" ? "bg-ice" : prize.jackpot ? "bg-sun" : "bg-sky-pale"}`}
          >
            <div className="text-[13px] font-black uppercase tracking-[.2em] text-navy/60">{demo ? "Demo landed on" : prize.kind === "none" ? "The wheel says" : "You won"}</div>
            <div className="mt-1 font-display text-[34px] font-extrabold leading-tight">{prize.label}</div>
            <div className="mt-1 text-[18px] font-black">
              {prize.kind === "none" ? "No prize this time. Your 80,000 TWAK from the mint is already yours." : prize.amount}
            </div>
            {prize.kind === "bonus" ? <div className="mt-1 text-sm font-bold text-navy/60">on top of the 80,000 TWAK from your mint</div> : null}
            {actions ? <div className="mt-4 flex flex-wrap justify-center gap-3">{actions}</div> : null}
          </motion.div>
        ) : (
          <div className="text-center font-bold text-navy/70">{idleNote}</div>
        )}
      </div>
    </div>
  );
}

export function ShareButton({ prizeId }: { prizeId: number }) {
  return (
    <Button
      tone="white"
      size="sm"
      onClick={() => {
        const url = `${window.location.origin}/draw`;
        const href = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText(prizeId))}&url=${encodeURIComponent(url)}`;
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      Share on X
    </Button>
  );
}

/** All 11 tiers with true odds, and live remaining counts when the contract provides them. */
export function PrizeLegend({ remaining }: { remaining?: number[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PRIZES.map((p) => (
        <div key={p.id} className="lift flex items-center gap-3 rounded-2xl border-[3px] border-navy bg-white px-4 py-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-navy font-display text-[13px] font-extrabold" style={{ background: p.fill, color: p.ink }}>
            {p.kind === "none" ? "✕" : p.wheel.replace("FULL", "100%")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[17px] font-extrabold leading-tight">{p.label}</div>
            <div className="text-sm font-bold text-navy/60">{p.amount}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-[15px] font-extrabold">
              {p.slots.toLocaleString("en-US")} / {DECK_SIZE.toLocaleString("en-US")}
            </div>
            <div className="text-xs font-black text-navy/55">{remaining ? `${remaining[p.id].toLocaleString("en-US")} left` : `${((p.slots / DECK_SIZE) * 100).toFixed(p.slots < 50 ? 1 : 0)}% odds`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ago(now: number, t?: number) {
  if (!t || !now) return "";
  const s = Math.max(0, now - t);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Live ticker of recent PrizeAssigned events. */
export function SpinFeed({ spins, emptyText = "No spins yet. The feed fills in live as prizes are assigned." }: { spins: Spin[]; emptyText?: string }) {
  const now = useNow(10_000);
  if (spins.length === 0) {
    return <div className="rounded-2xl border-[3px] border-dashed border-navy/40 bg-white/60 px-4 py-6 text-center font-bold text-navy/60">{emptyText}</div>;
  }
  return (
    <ul className="space-y-2.5">
      <AnimatePresence initial={false}>
        {spins.map((s) => {
          const p = PRIZES[s.prizeId] ?? PRIZES[10];
          return (
            <motion.li
              key={s.key}
              layout
              initial={{ opacity: 0, x: -30, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="stub flex items-center gap-3 rounded-2xl px-5 py-2.5"
              style={{ background: p.kind === "none" ? "#EEF8FF" : p.fill, color: p.kind === "none" ? "#13204A" : p.ink }}
            >
              <span className="font-mono text-sm font-bold">{shortAddr(s.minter)}</span>
              <span className="flex-1 text-right font-display text-[16px] font-extrabold">{p.label}</span>
              <span className="w-[62px] text-right text-xs font-black opacity-70">{s.demo ? "demo" : ago(now, s.time)}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
