"use client";

import { useMemo, useState } from "react";
import { Button, Panel, inputClass } from "@/components/ui";
import { fmtCompactUsd, fmtFunding, fmtPrice, trimDecimal, type MarketRow } from "@/lib/aster/markets";

const TOP = 12;

export function MarketsBoard({
  rows,
  loading,
  error,
  selected,
  onSelect,
}: {
  rows: MarketRow[] | undefined;
  loading: boolean;
  error: string | undefined;
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    const list = rows ?? [];
    const hit = t ? list.filter((r) => r.symbol.includes(t)) : list;
    return all || t ? hit : hit.slice(0, TOP);
  }, [rows, q, all]);

  return (
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[28px] font-extrabold">Markets</h2>
          <p className="text-sm font-bold text-navy/60">Sorted by 24h volume. Refreshes every 15s. No key needed.</p>
        </div>
        <input
          className={`${inputClass} !w-full !py-2 !text-[16px] sm:!w-[200px]`}
          placeholder="Search BTC, ETH…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search markets"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border-[3px] border-navy bg-candy-pale px-4 py-3 font-bold">
          Couldn&apos;t reach Aster&apos;s public API: {error}. Retrying…
        </p>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-3xl border-[3px] border-navy">
        <table className="w-full table-fixed text-left">
          <thead className="bg-ice text-[12px] font-black uppercase tracking-widest text-navy/60">
            <tr>
              <th scope="col" className="w-[34%] px-3 py-2 sm:w-[22%]">Market</th>
              <th scope="col" className="px-3 py-2 text-right">Last</th>
              <th scope="col" className="px-3 py-2 text-right">24h</th>
              <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">Mark</th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">Funding</th>
              <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">Volume</th>
            </tr>
          </thead>
          <tbody className="font-bold">
            {loading && !rows ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-navy/60">
                  Loading Aster markets…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-navy/60">
                  No market matches “{q}”.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const on = r.symbol === selected;
                const up = (r.changePct ?? 0) >= 0;
                return (
                  <tr
                    key={r.symbol}
                    className={`cursor-pointer border-t-2 border-navy/10 ${on ? "bg-sun-pale" : "hover:bg-sky-pale"}`}
                    onClick={() => onSelect(r.symbol)}
                  >
                    <td className="truncate px-3 py-2.5">
                      <button
                        type="button"
                        className="font-display text-[16px] font-extrabold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun"
                        aria-pressed={on}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(r.symbol);
                        }}
                      >
                        {r.base || r.symbol}
                      </button>
                      <span className="ml-1 hidden text-xs text-navy/50 sm:inline">PERP</span>
                    </td>
                    <td className="truncate px-3 py-2.5 text-right font-mono text-[14px]">{trimDecimal(r.lastPrice)}</td>
                    <td className={`px-3 py-2.5 text-right text-[14px] ${up ? "text-sky-deep" : "text-candy-deep"}`}>
                      {r.changePct === undefined ? "—" : `${up ? "+" : ""}${r.changePct.toFixed(2)}%`}
                    </td>
                    <td className="hidden truncate px-3 py-2.5 text-right font-mono text-[14px] md:table-cell">{fmtPrice(r.markPrice, r.priceDecimals)}</td>
                    <td className="hidden px-3 py-2.5 text-right text-[14px] sm:table-cell">{fmtFunding(r.fundingRate)}</td>
                    <td className="hidden px-3 py-2.5 text-right text-[14px] lg:table-cell">{fmtCompactUsd(r.quoteVolume)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows && rows.length > TOP && !q ? (
        <div className="mt-4 flex justify-center">
          <Button tone="white" size="sm" onClick={() => setAll((a) => !a)}>
            {all ? `Show top ${TOP}` : `Show all ${rows.length} markets`}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
