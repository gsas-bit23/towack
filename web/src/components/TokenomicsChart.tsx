import { CoinColumn } from "./motion";

// 1B TWAK split. Mirrors TowackToken constants; must sum to 100.
export const SPLIT = [
  { pct: 40, color: "#FF4FA3", label: "Public mint", note: "400M · 80k per mint" },
  { pct: 20, color: "#1FC6F2", label: "Initial LP", note: "200M · at mint price" },
  { pct: 10, color: "#FFCD2E", label: "Trader rebates", note: "100M · 104 weeks" },
  { pct: 7, color: "#FF4FA3", label: "Draw V2 prizes", note: "70M · weekly rounds" },
  { pct: 5, color: "#1FC6F2", label: "Draw V1 bonus reserve", note: "50M · unused burned" },
  { pct: 5, color: "#13204A", label: "Team vesting", note: "1-yr cliff, 4-yr daily" },
  { pct: 5, color: "#FFCD2E", label: "Seasons & referrals", note: "50M" },
  { pct: 5, color: "#1FC6F2", label: "Ecosystem / dev", note: "50M" },
  { pct: 3, color: "#FFCD2E", label: "POL buffer", note: "30M" },
] as const;

export const SPLIT_TOTAL = SPLIT.reduce((a, s) => a + s.pct, 0);

export function TokenomicsChart() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid h-[340px] grid-cols-9 items-end gap-4" role="img" aria-label={SPLIT.map((s) => `${s.label} ${s.pct}%`).join(", ")}>
          {SPLIT.map((s, i) => (
            <CoinColumn key={s.label} index={i} count={Math.max(1, Math.round(s.pct / 2.5))} color={s.color} label={`${s.pct}%`} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-9 gap-4 text-center text-[13px] font-black leading-tight">
          {SPLIT.map((s) => (
            <div key={s.label}>
              {s.label}
              <br />
              <span className="font-bold text-navy/60">{s.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
