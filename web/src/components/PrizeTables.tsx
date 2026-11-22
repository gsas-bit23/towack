"use client";

// Draw V1 prize deck visuals. Numbers come from lib/prizes.ts, which mirrors TowackLaunch.prizeSlots /
// prizeBnb / prizeBonus. One deck, 5,000 slots, one outcome per mint.

import { motion, useReducedMotion } from "motion/react";
import { DECK_SIZE, PRIZES } from "@/lib/prizes";

const BNB_STYLE = [
  { cls: "bg-sun text-navy", sub: "text-navy/70", line: "border-navy/40", tier: "ID 0" },
  { cls: "bg-candy text-white", sub: "text-white/80", line: "border-white/50", tier: "ID 1" },
  { cls: "bg-sky text-navy", sub: "text-navy/70", line: "border-navy/40", tier: "ID 2" },
  { cls: "bg-navy text-white", sub: "text-white/70", line: "border-white/40", tier: "ID 3" },
];

const BNB = PRIZES.filter((p) => p.kind === "bnb");
const BONUS = PRIZES.filter((p) => p.kind === "bonus");
const NONE = PRIZES[10];
const BONUS_H = [40, 50, 60, 70, 80, 88];
const BONUS_COLOR = ["bg-candy", "bg-candy", "bg-sky", "bg-sky", "bg-sun", "bg-sun"];

export function BnbTierStubs() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {BNB.map((t, i) => (
          <div key={t.id} className={`press stub rounded-3xl p-6 text-center ${BNB_STYLE[i].cls}`}>
            <div className="font-display text-[44px] font-extrabold leading-none lg:text-[54px]">{t.slots.toLocaleString("en-US")}</div>
            <div className="mt-3 text-[18px] font-black">{t.label}</div>
            <div className={`mt-1 font-bold ${BNB_STYLE[i].sub}`}>{t.amount}</div>
            <div className={`mt-4 border-t-2 border-dashed pt-3 text-[13px] font-black tracking-widest ${BNB_STYLE[i].line}`}>
              {t.slots} / {DECK_SIZE.toLocaleString("en-US")}
            </div>
          </div>
        ))}
        <div className="press stub rounded-3xl bg-ice p-6 text-center text-navy/70">
          <div className="font-display text-[44px] font-extrabold leading-none lg:text-[54px]">{NONE.slots}</div>
          <div className="mt-3 text-[18px] font-black">Better luck next time</div>
          <div className="mt-1 font-bold">keep your 80k TWAK</div>
          <div className="mt-4 border-t-2 border-dashed border-navy/25 pt-3 text-[13px] font-black tracking-widest">NO PRIZE</div>
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
    { w: 500, c: "bg-sun" },
    { w: 600, c: "bg-candy" },
    { w: 800, c: "bg-sky" },
    { w: 1600, c: "bg-navy" },
    { w: 1020, c: "bg-candy-pale" },
    { w: 480, c: "bg-ice" },
  ];
  return (
    <>
      <div className="mt-7 flex h-5 overflow-hidden rounded-full border-[3px] border-navy" aria-hidden="true">
        {segs.map((s, i) => (
          <motion.div
            key={i}
            className={s.c}
            initial={reduce ? false : { width: 0 }}
            whileInView={{ width: `${(s.w / DECK_SIZE) * 100}%` }}
            viewport={{ once: true }}
            style={reduce ? { width: `${(s.w / DECK_SIZE) * 100}%` } : undefined}
            transition={{ delay: i * 0.12, duration: 0.6, ease: "easeOut" }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[13px] font-extrabold text-navy/60">
        <span>3,500 BNB refunds</span>
        <span>1,020 TWAK bonuses (pink)</span>
        <span>480 no prize</span>
      </div>
    </>
  );
}

export function BonusBars() {
  const reduce = useReducedMotion();
  return (
    <>
      <div className="mt-6 grid min-w-0 grid-cols-3 items-end gap-x-3 gap-y-5 sm:grid-cols-6">
        {BONUS.map((b, i) => (
          <div key={b.id} className="flex h-[150px] min-w-0 flex-col items-center justify-end sm:h-[190px]">
            <div className="whitespace-nowrap font-display text-[22px] font-extrabold lg:text-[26px]">{b.wheel}</div>
            <motion.div
              className={`w-full origin-bottom rounded-t-2xl border-[3px] border-navy ${BONUS_COLOR[i]}`}
              style={{ height: `${BONUS_H[i]}%` }}
              // Never scaleY 0: bars stay readable even if the observer never fires (see CoinColumn).
              initial={reduce ? false : { scaleY: 0.85 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ type: "spring", stiffness: 160, damping: 16, delay: i * 0.08 }}
            />
            <div className="mt-2 whitespace-nowrap text-sm font-black">{b.slots.toLocaleString("en-US")}</div>
            <div className="whitespace-nowrap text-[11px] font-extrabold text-navy/60">{b.amount.replace(" TWAK", "")}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[13px] font-extrabold text-navy/55">
        slots per multiplier · extra TWAK on top of the 80,000 from the mint
      </div>
    </>
  );
}
