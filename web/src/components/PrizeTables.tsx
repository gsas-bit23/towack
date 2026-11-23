"use client";

// Draw V1 prize deck visuals. Numbers come from lib/prizes.ts, which mirrors TowackLaunch.prizeSlots /
// prizeBnb / prizeBonus. One deck, 5,000 slots, one outcome per mint.

import { motion, useReducedMotion } from "motion/react";
import { DECK_SIZE, PRIZES } from "@/lib/prizes";

const BNB = PRIZES.filter((p) => p.kind === "bnb");
const BONUS = PRIZES.filter((p) => p.kind === "bonus");
const NONE = PRIZES[10];
const BONUS_H = [40, 50, 60, 70, 80, 88];
const BONUS_COLOR = ["bg-[#3A414B]", "bg-[#3A414B]", "bg-[#4A3C10]", "bg-[#4A3C10]", "bg-gold/80", "bg-gold"];

export function BnbTierStubs() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {BNB.map((t, i) => (
          <div key={t.id} className={`lift min-w-0 rounded-xl border p-4 ${i === 0 ? "border-gold/40 bg-gold/[.06]" : "border-line bg-card-2"}`}>
            <div className={`font-mono text-[28px] font-medium leading-none tracking-tight lg:text-[32px] ${i === 0 ? "text-gold" : ""}`}>
              {t.slots.toLocaleString("en-US")}
            </div>
            <div className="mt-3 text-[14px] font-semibold">{t.label}</div>
            <div className="mt-0.5 font-mono text-[12.5px] text-muted">{t.amount}</div>
            <div className="mt-3 border-t border-line pt-2.5 font-mono text-[12px] text-dim">
              {t.slots} / {DECK_SIZE.toLocaleString("en-US")}
            </div>
          </div>
        ))}
        <div className="lift min-w-0 rounded-xl border border-dashed border-line-2 p-4">
          <div className="font-mono text-[28px] font-medium leading-none tracking-tight text-muted lg:text-[32px]">{NONE.slots}</div>
          <div className="mt-3 text-[14px] font-semibold">Better luck next time</div>
          <div className="mt-0.5 font-mono text-[12.5px] text-muted">keep your 80k TWAK</div>
          <div className="mt-3 border-t border-line pt-2.5 font-mono text-[12px] text-dim">NO PRIZE</div>
        </div>
      </div>
      <DeckBar />
    </>
  );
}

/** Whole deck as one bar: every slot is exactly one outcome. */
export function DeckBar() {
  const reduce = useReducedMotion();
  const segs = [
    { w: 500, c: "bg-gold" },
    { w: 600, c: "bg-[#B08A10]" },
    { w: 800, c: "bg-[#6B5414]" },
    { w: 1600, c: "bg-[#4A3C10]" },
    { w: 1020, c: "bg-up/70" },
    { w: 480, c: "bg-line-2" },
  ];
  return (
    <>
      {/* Segments keep their flex widths; only scaleX animates (no layout work). */}
      <div className="mt-6 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {segs.map((s, i) => (
          <motion.div
            key={i}
            className={`h-full origin-left ${s.c}`}
            style={{ flex: s.w }}
            initial={reduce ? false : { scaleX: 0.3 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[12.5px] text-muted">
        <span>3,500 BNB refunds (gold)</span>
        <span>1,020 TWAK bonuses (green)</span>
        <span>480 no prize</span>
      </div>
    </>
  );
}

export function BonusBars() {
  const reduce = useReducedMotion();
  return (
    <>
      <div className="mt-6 grid min-w-0 grid-cols-3 items-start gap-x-3 gap-y-5 sm:grid-cols-6">
        {BONUS.map((b, i) => (
          <div key={b.id} className="flex min-w-0 flex-col items-center">
            <div className="whitespace-nowrap font-mono text-[17px] font-medium leading-tight lg:text-[20px]">{b.wheel}</div>
            {/* Dedicated bar track: heights are % of this box only, so labels/counts never squash the steps. */}
            <div className="mt-1 flex h-[96px] w-full items-end border-b border-line sm:h-[132px]">
              <motion.div
                className={`w-full origin-bottom rounded-t-md ${BONUS_COLOR[i]}`}
                style={{ height: `${BONUS_H[i]}%` }}
                // Never scaleY 0: bars stay readable even if the observer never fires (see CoinColumn).
                initial={reduce ? false : { scaleY: 0.85 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ type: "spring", stiffness: 200, damping: 24, delay: i * 0.06 }}
              />
            </div>
            <div className="mt-2 whitespace-nowrap font-mono text-[13px] font-medium">{b.slots.toLocaleString("en-US")}</div>
            <div className="whitespace-nowrap font-mono text-[11px] text-muted">{b.amount.replace(" TWAK", "")}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-[12.5px] text-muted">
        slots per multiplier · extra TWAK on top of the 80,000 from the mint
      </div>
    </>
  );
}
