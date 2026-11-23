"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { midSpread, withTotals, type Book, type Trade } from "@/lib/aster/marketData";
import { trimDecimal } from "@/lib/aster/markets";
import { FeedBadge } from "./PriceChart";
import type { FeedStatus } from "./useAsterStream";

const fmtQty = (q: number) => (q >= 1000 ? q.toLocaleString("en-US", { maximumFractionDigits: 1 }) : q.toLocaleString("en-US", { maximumFractionDigits: 4 }));

/** Order book and recent trades share one column; a tab switches between them. */
export function BookTrades({
  book,
  trades,
  decimals,
  base,
  status,
  lastPrice,
  markPrice,
  bookError,
  onPickPrice,
  rows = 10,
}: {
  book: Book | undefined;
  trades: Trade[] | undefined;
  decimals: number;
  base: string;
  status: FeedStatus;
  lastPrice?: string;
  markPrice?: string;
  bookError?: string;
  onPickPrice: (price: string) => void;
  rows?: number;
}) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const { t } = useLocale();
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label={t("perps.b.tabsAria")}>
          {(
            [
              ["book", t("perps.b.book")],
              ["trades", t("perps.b.trades")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-md px-2 py-1 text-[12.5px] font-semibold ${tab === k ? "bg-card-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <FeedBadge status={status} note={t("perps.feed.poll3")} />
      </div>
      {tab === "book" ? (
        <OrderBook book={book} decimals={decimals} base={base} lastPrice={lastPrice} markPrice={markPrice} error={bookError} onPickPrice={onPickPrice} rows={rows} />
      ) : (
        <RecentTrades trades={trades} decimals={decimals} base={base} />
      )}
    </div>
  );
}

function OrderBook({
  book,
  decimals,
  base,
  lastPrice,
  markPrice,
  error,
  onPickPrice,
  rows,
}: {
  book: Book | undefined;
  decimals: number;
  base: string;
  lastPrice?: string;
  markPrice?: string;
  error?: string;
  onPickPrice: (price: string) => void;
  rows: number;
}) {
  const { t } = useLocale();
  if (!book) {
    return <p className="px-3 py-6 text-center text-[13px] text-muted">{error ? t("perps.b.loadErr", { e: error }) : t("perps.b.loading")}</p>;
  }
  const asks = withTotals(book.asks, rows);
  const bids = withTotals(book.bids, rows);
  const max = Math.max(asks[asks.length - 1]?.total ?? 0, bids[bids.length - 1]?.total ?? 0) || 1;
  const ms = midSpread(book);
  const d = Math.min(decimals, 8);
  const row = (l: (typeof asks)[number], side: "ask" | "bid") => (
    <li key={`${side}${l.price}`}>
      <button
        type="button"
        onClick={() => onPickPrice(l.price)}
        className="relative grid w-full grid-cols-3 px-3 py-[2px] text-right font-mono text-[12px] tabular-nums hover:bg-card-2"
        title={t("perps.b.usePrice")}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 right-0 w-full origin-right ${side === "ask" ? "bg-down/10" : "bg-up/10"}`}
          style={{ transform: `scaleX(${l.total / max})` }}
        />
        <span className={`relative text-left ${side === "ask" ? "text-down" : "text-up"}`}>{l.p.toFixed(d)}</span>
        <span className="relative text-sub">{fmtQty(l.q)}</span>
        <span className="relative text-muted">{fmtQty(l.total)}</span>
      </button>
    </li>
  );
  return (
    <div className="min-h-0 flex-1 py-1">
      <div className="grid grid-cols-3 px-3 pb-1 text-right text-[11px] font-medium text-dim">
        <span className="text-left">{t("perps.b.price")}</span>
        <span>{t("perps.b.size", { base })}</span>
        <span>{t("perps.b.total")}</span>
      </div>
      <ul aria-label={t("perps.b.asks")} className="flex flex-col-reverse">
        {asks.map((l) => row(l, "ask"))}
      </ul>
      <div className="my-1 flex flex-wrap items-baseline justify-between gap-x-2 border-y border-line bg-surface px-3 py-1.5">
        <span className="font-mono text-[15px] font-medium tabular-nums">{trimDecimal(lastPrice)}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {markPrice ? t("perps.b.mark", { p: Number(markPrice).toFixed(d) }) : ""}
          {ms ? t("perps.b.spread", { s: ms.spread.toFixed(d), p: ms.spreadPct.toFixed(3) }) : ""}
        </span>
      </div>
      <ul aria-label={t("perps.b.bids")}>
        {bids.map((l) => row(l, "bid"))}
      </ul>
      {!asks.length && !bids.length ? <p className="px-3 py-4 text-center text-[13px] text-muted">{t("perps.b.empty")}</p> : null}
    </div>
  );
}

function RecentTrades({ trades, decimals, base }: { trades: Trade[] | undefined; decimals: number; base: string }) {
  const { t } = useLocale();
  if (!trades) return <p className="px-3 py-6 text-center text-[13px] text-muted">{t("perps.b.loadingTrades")}</p>;
  if (!trades.length) return <p className="px-3 py-6 text-center text-[13px] text-muted">{t("perps.b.noTrades")}</p>;
  const d = Math.min(decimals, 8);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      <div className="grid grid-cols-3 px-3 pb-1 text-right text-[11px] font-medium text-dim">
        <span className="text-left">{t("perps.b.price")}</span>
        <span>{t("perps.b.size", { base })}</span>
        <span>{t("perps.b.time")}</span>
      </div>
      <ul aria-label={t("perps.b.recentAria")}>
        {trades.slice(0, 40).map((tr) => (
          <li key={tr.id} className="grid grid-cols-3 px-3 py-[2px] text-right font-mono text-[12px] tabular-nums">
            <span className={`text-left ${tr.side === "BUY" ? "text-up" : "text-down"}`}>{Number(tr.price).toFixed(d)}</span>
            <span className="text-sub">{fmtQty(Number(tr.qty))}</span>
            <span className="text-muted">{new Date(tr.time).toLocaleTimeString("en-GB", { hour12: false })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
