import { CoinColumn } from "./motion";

// 1B TWAK split. Mirrors TowackToken constants; must sum to 100.
export const SPLIT = [
  { pct: 40, color: "#F0B90B", label: "Public mint", note: "400M · 80k per mint" },
  { pct: 20, color: "#B08A10", label: "Initial LP", note: "200M · at mint price" },
  { pct: 10, color: "#0ECB81", label: "Trader rebates", note: "100M · 104 weeks" },
  { pct: 7, color: "#4A9E7C", label: "Draw V2 prizes", note: "70M · pool wheel seed" },
  { pct: 5, color: "#6B5414", label: "Draw V1 bonus reserve", note: "50M · unused burned" },
  { pct: 5, color: "#B7BDC6", label: "Team vesting", note: "1-yr cliff, 4-yr daily" },
  { pct: 5, color: "#8B94A3", label: "Seasons & referrals", note: "50M" },
  { pct: 5, color: "#6B7380", label: "Ecosystem / dev", note: "50M" },
  { pct: 3, color: "#3A414B", label: "POL buffer", note: "30M" },
] as const;

export const SPLIT_TOTAL = SPLIT.reduce((a, s) => a + s.pct, 0);

const MAX_PCT = Math.max(...SPLIT.map((s) => s.pct));

/**
 * Phones/tablets: one stacked row per slice (label, note, coin bar) so all nine are visible with no sideways scroll.
 * lg+: the coin-pusher column chart. Both are always visible (no reliance on an intersection observer).
 */
export function TokenomicsChart() {
  const aria = SPLIT.map((s) => `${s.label} ${s.pct}%`).join(", ");
  return (
    <div className="min-w-0">
      <ul className="space-y-3 lg:hidden" aria-label={aria}>
        {SPLIT.map((s) => (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[14px] font-medium leading-tight">
                {s.label} <span className="block text-[13px] font-medium text-muted sm:inline sm:pl-1">{s.note}</span>
              </span>
              <span className="shrink-0 font-mono text-[17px] font-medium leading-none">{s.pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-card-2">
              <div
                className="h-full w-full origin-left rounded-full"
                style={{ transform: `scaleX(${Math.max(0.08, s.pct / MAX_PCT)})`, background: s.color }}
                aria-hidden="true"
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <div className="grid h-[340px] grid-cols-9 items-end gap-4" role="img" aria-label={aria}>
          {SPLIT.map((s, i) => (
            <CoinColumn key={s.label} index={i} count={Math.max(1, Math.round(s.pct / 2.5))} color={s.color} label={`${s.pct}%`} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-9 gap-4 text-center text-[12.5px] font-medium leading-tight">
          {SPLIT.map((s) => (
            <div key={s.label} className="min-w-0 break-words">
              {s.label}
              <br />
              <span className="font-normal text-muted">{s.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
