"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtCompactUsd, fmtFunding, fmtPrice, trimDecimal, type AsterNet, type MarketRow } from "@/lib/aster/markets";
import { useNow } from "@/lib/useNow";

function countdown(next: number | undefined, nowSec: number): string {
  if (!next || !nowSec) return "—";
  const left = Math.max(0, Math.floor(next / 1000) - nowSec);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`;
}

/** Symbol selector + live stats strip (last, 24h change / volume, mark, index, funding, next funding countdown). */
export function MarketHeader({
  net,
  symbol,
  row,
  rows,
  loading,
  error,
  onSelect,
}: {
  net: AsterNet;
  symbol: string;
  row: MarketRow | undefined;
  rows: MarketRow[] | undefined;
  loading: boolean;
  error: string | undefined;
  onSelect: (symbol: string) => void;
}) {
  const now = useNow(1_000);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const up = (row?.changePct ?? 0) >= 0;
  const d = row?.priceDecimals ?? 8;
  const stats: [string, string, string?][] = [
    ["24h change", row?.changePct === undefined ? "—" : `${up ? "+" : ""}${row.changePct.toFixed(2)}%`, row?.changePct === undefined ? "" : up ? "text-up" : "text-down"],
    ["24h volume", fmtCompactUsd(row?.quoteVolume)],
    ["Mark", fmtPrice(row?.markPrice, d)],
    ["Index", fmtPrice(row?.indexPrice, d)],
    ["Funding", fmtFunding(row?.fundingRate), (row?.fundingRate ?? 0) < 0 ? "text-down" : "text-up"],
    ["Next funding", countdown(row?.nextFundingTime, now)],
  ];

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-left hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
        >
          <span>
            <span className="block text-[22px] font-semibold leading-tight tracking-tight sm:text-[24px]">{symbol}</span>
            <span className="block text-[11px] font-medium uppercase tracking-[.1em] text-muted">{net === "testnet" ? "Aster testnet" : "Aster"} · perpetual</span>
          </span>
          <span className="text-muted" aria-hidden="true">
            ▾
          </span>
          <span className="sr-only">Change market</span>
        </button>
        <div className="min-w-0">
          <div className={`font-mono text-[22px] font-medium leading-tight tabular-nums tracking-tight ${row?.changePct === undefined ? "" : up ? "text-up" : "text-down"}`}>{trimDecimal(row?.lastPrice)}</div>
          <div className="text-[11px] font-medium text-muted">last price</div>
        </div>
      </div>
      <dl className="grid min-w-0 basis-full grid-cols-3 gap-x-4 gap-y-2 md:basis-0 md:flex-1 xl:flex xl:flex-wrap xl:gap-x-7">
        {stats.map(([k, v, cls]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted">{k}</dt>
            <dd className={`truncate font-mono text-[13px] font-medium tabular-nums ${cls ?? ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {error ? (
        <p role="alert" className="w-full rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-[13px]">
          Couldn&apos;t reach Aster&apos;s public API: {error}. Retrying…
        </p>
      ) : null}
      {open ? <MarketPicker rows={rows} loading={loading} selected={symbol} onClose={close}
          onSelect={(s) => {
            onSelect(s);
            close();
          }} /> : null}
    </div>
  );
}

function MarketPicker({
  rows,
  loading,
  selected,
  onSelect,
  onClose,
}: {
  rows: MarketRow[] | undefined;
  loading: boolean;
  selected: string;
  onSelect: (s: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (rows ?? []).filter((r) => !t || r.symbol.includes(t));
  }, [rows, q]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", key);
    const id = setTimeout(() => window.addEventListener("mousedown", click), 0);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", click);
      clearTimeout(id);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Choose a market"
      className="absolute left-2 right-2 top-[calc(100%+6px)] z-40 rounded-xl border border-line-2 bg-card-2 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,.8)] sm:right-auto sm:w-[440px]"
    >
      <input
        autoFocus
        className="w-full rounded-lg border border-line-2 bg-card px-3 py-2 text-[15px] text-fg placeholder:text-dim focus:border-gold focus:outline-none"
        placeholder="Search BTC, ETH…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search markets"
      />
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 px-2 text-[11px] font-medium text-dim">
        <span>Market</span>
        <span className="text-right">Last</span>
        <span className="w-[64px] text-right">24h</span>
      </div>
      <ul className="mt-1 max-h-[340px] overflow-y-auto">
        {loading && !rows ? (
          <li className="px-2 py-3 text-[13px] text-muted">Loading Aster markets…</li>
        ) : list.length === 0 ? (
          <li className="px-2 py-3 text-[13px] text-muted">No market matches “{q}”.</li>
        ) : (
          list.map((r) => {
            const up = (r.changePct ?? 0) >= 0;
            return (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(r.symbol)}
                  aria-current={r.symbol === selected}
                  className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left hover:bg-card ${r.symbol === selected ? "bg-gold/5" : ""}`}
                >
                  <span className="truncate text-[13.5px] font-semibold">
                    {r.base || r.symbol}
                    <span className="ml-1 text-[11px] font-medium text-dim">PERP · {fmtCompactUsd(r.quoteVolume)}</span>
                  </span>
                  <span className="text-right font-mono text-[12.5px] tabular-nums">{trimDecimal(r.lastPrice)}</span>
                  <span className={`w-[64px] text-right font-mono text-[12.5px] tabular-nums ${up ? "text-up" : "text-down"}`}>
                    {r.changePct === undefined ? "—" : `${up ? "+" : ""}${r.changePct.toFixed(2)}%`}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      <p className="px-2 pt-2 text-[11px] text-dim">Sorted by 24h volume. Public Aster data, no key.</p>
    </div>
  );
}
