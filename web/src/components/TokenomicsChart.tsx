"use client";

import { useLocale } from "@/lib/i18n";
import { SPLIT, splitKey } from "@/lib/tokenomics";
import { CoinColumn } from "./motion";

const MAX_PCT = Math.max(...SPLIT.map((s) => s.pct));

/**
 * Phones/tablets: one stacked row per slice (label, note, coin bar) so all nine are visible with no sideways scroll.
 * lg+: the coin-pusher column chart. Both are always visible (no reliance on an intersection observer).
 */
export function TokenomicsChart() {
  const { t } = useLocale();
  const aria = SPLIT.map((s, i) => `${t(splitKey(i))} ${s.pct}%`).join(", ");
  return (
    <div className="min-w-0">
      <ul className="space-y-3 lg:hidden" aria-label={aria}>
        {SPLIT.map((s, i) => (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[14px] font-medium leading-tight">
                {t(splitKey(i))} <span className="block text-[13px] font-medium text-muted sm:inline sm:pl-1">{t(splitKey(i, true))}</span>
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
          {SPLIT.map((s, i) => (
            <div key={s.label} className="min-w-0 break-words">
              {t(splitKey(i))}
              <br />
              <span className="font-normal text-muted">{t(splitKey(i, true))}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
