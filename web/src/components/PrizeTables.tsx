// Draw V1 prize tables. Numbers mirror TowackLaunch.bnbTierSlots / bnbTierAmount / bonusTierSlots / bonusTierAmount.

export const BNB_TIERS = [
  { slots: 500, label: "100% refund", amount: "0.1 BNB", tier: "TIER A", cls: "bg-sun text-navy", sub: "text-navy/70", line: "border-navy/40" },
  { slots: 600, label: "75% back", amount: "0.075 BNB", tier: "TIER B", cls: "bg-candy text-white", sub: "text-white/80", line: "border-white/50" },
  { slots: 800, label: "50% back", amount: "0.05 BNB", tier: "TIER C", cls: "bg-sky text-navy", sub: "text-navy/70", line: "border-navy/40" },
  { slots: 1600, label: "25% back", amount: "0.025 BNB", tier: "TIER D", cls: "bg-navy text-white", sub: "text-white/70", line: "border-white/40" },
] as const;

export const NO_PRIZE_SLOTS = 1500;

export const BONUS_TIERS = [
  { mult: "5×", slots: 20, extra: "+320,000", color: "bg-candy", h: 40 },
  { mult: "3×", slots: 40, extra: "+160,000", color: "bg-candy", h: 50 },
  { mult: "2×", slots: 80, extra: "+80,000", color: "bg-sky", h: 60 },
  { mult: "1.5×", slots: 160, extra: "+40,000", color: "bg-sky", h: 70 },
  { mult: "1.25×", slots: 320, extra: "+20,000", color: "bg-sun", h: 80 },
  { mult: "1.1×", slots: 400, extra: "+8,000", color: "bg-sun", h: 88 },
] as const;

export function BnbTierStubs({ counts }: { counts?: number[] }) {
  const noPrize = counts ? counts[4] : NO_PRIZE_SLOTS;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {BNB_TIERS.map((t, i) => (
          <div key={t.tier} className={`press stub rounded-3xl p-6 text-center ${t.cls}`}>
            <div className="font-display text-[44px] font-extrabold leading-none lg:text-[54px]">{(counts ? counts[i] : t.slots).toLocaleString("en-US")}</div>
            <div className="mt-3 text-[18px] font-black">{t.label}</div>
            <div className={`mt-1 font-bold ${t.sub}`}>{t.amount}</div>
            <div className={`mt-4 border-t-2 border-dashed pt-3 text-[13px] font-black tracking-widest ${t.line}`}>{t.tier}</div>
          </div>
        ))}
        <div className="stub rounded-3xl bg-ice p-6 text-center text-navy/70">
          <div className="font-display text-[44px] font-extrabold leading-none lg:text-[54px]">{noPrize.toLocaleString("en-US")}</div>
          <div className="mt-3 text-[18px] font-black">No BNB prize</div>
          <div className="mt-1 font-bold">keep your TWAK</div>
          <div className="mt-4 border-t-2 border-dashed border-navy/25 pt-3 text-[13px] font-black tracking-widest">NO TIER</div>
        </div>
      </div>
      <div className="mt-7 flex h-5 overflow-hidden rounded-full border-[3px] border-navy" aria-hidden="true">
        <div className="bg-sun" style={{ width: "10%" }} />
        <div className="bg-candy" style={{ width: "12%" }} />
        <div className="bg-sky" style={{ width: "16%" }} />
        <div className="bg-navy" style={{ width: "32%" }} />
        <div className="bg-ice" style={{ width: "30%" }} />
      </div>
      <div className="mt-2 flex justify-between text-[13px] font-extrabold text-navy/60">
        <span>slot 1</span>
        <span>share of all 5,000 slots</span>
        <span>slot 5,000</span>
      </div>
    </>
  );
}

export function BonusBars({ counts }: { counts?: number[] }) {
  return (
    <>
      <div className="mt-6 flex h-[190px] items-end gap-3">
        {BONUS_TIERS.map((b, i) => (
          <div key={b.mult} className="flex h-full flex-1 flex-col items-center justify-end">
            <div className="font-display text-[22px] font-extrabold lg:text-[26px]">{b.mult}</div>
            <div className={`w-full rounded-t-2xl border-[3px] border-navy ${b.color}`} style={{ height: `${b.h}%` }} />
            <div className="mt-2 text-sm font-black">{(counts ? counts[i] : b.slots).toLocaleString("en-US")}</div>
            <div className="text-[11px] font-extrabold text-navy/60">{b.extra}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[13px] font-extrabold text-navy/55">
        winners per multiplier · extra TWAK on top of the 80,000 from the mint
      </div>
    </>
  );
}

/** floor(n * slots / 5000), same as TowackLaunch.bnbTierCount / bonusTierCount. */
export function scaledCounts(n: number) {
  const bnb = BNB_TIERS.map((t) => Math.floor((n * t.slots) / 5000));
  const bnbNone = n - bnb.reduce((a, b) => a + b, 0);
  const bonus = BONUS_TIERS.map((t) => Math.floor((n * t.slots) / 5000));
  return { bnb: [...bnb, bnbNone], bonus };
}
