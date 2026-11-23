"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/motion";
import { Button } from "@/components/ui";
import { explainAsterError, signedRequest, type StoredAgent } from "@/lib/aster/client";
import { trimDecimal } from "@/lib/aster/markets";
import { cancelParams, parseOpenOrders, parseOrderHistory, parseUserTrades } from "@/lib/aster/orders";
import { usePositionRisk } from "./useAsterAccount";

type Tab = "positions" | "open" | "history" | "trades";
const TABS: [Tab, string][] = [
  ["positions", "Positions"],
  ["open", "Open orders"],
  ["history", "Order history"],
  ["trades", "Trade history"],
];

const fmtTime = (ms: number | undefined) => (ms ? new Date(ms).toLocaleString("en-GB", { hour12: false, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const num = (v: string, d = 2) => {
  const x = Number(v);
  return Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }) : "—";
};
const pnlCls = (v: string) => (Number(v) > 0 ? "text-up" : Number(v) < 0 ? "text-down" : "text-sub");

/** Account blotter. Without an API wallet it renders the tab shell and a setup prompt: never demo rows. */
export function Blotter({ agent, symbol, onNeedAgent }: { agent: StoredAgent | undefined; symbol: string; onNeedAgent: () => void }) {
  const [tab, setTab] = useState<Tab>("positions");
  const [allSymbols, setAllSymbols] = useState(false);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3">
        <div className="-mb-px flex min-w-0 flex-wrap" role="tablist" aria-label="Account">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`border-b-2 px-2.5 py-2.5 text-[13px] font-semibold sm:px-3 ${tab === k ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {agent && (tab === "open" || tab === "positions") ? (
          <label className="flex items-center gap-2 py-2 text-[12px] text-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-gold" checked={allSymbols} onChange={(e) => setAllSymbols(e.target.checked)} />
            All markets
          </label>
        ) : agent ? (
          <span className="py-2 text-[12px] text-dim">{symbol} · last 7 days</span>
        ) : null}
      </div>
      <div className="min-h-[140px]">
        {!agent ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="max-w-[420px] text-[13.5px] text-sub">Set up an Aster API wallet to see your positions, open orders, order history and fills. Nothing is shown until Aster returns your real account.</p>
            <Button tone="soft" size="sm" onClick={onNeedAgent}>
              Set up API wallet
            </Button>
          </div>
        ) : tab === "positions" ? (
          <Positions agent={agent} symbol={allSymbols ? undefined : symbol} />
        ) : tab === "open" ? (
          <OpenOrders agent={agent} symbol={allSymbols ? undefined : symbol} />
        ) : tab === "history" ? (
          <OrderHistory agent={agent} symbol={symbol} />
        ) : (
          <TradeHistory agent={agent} symbol={symbol} />
        )}
      </div>
    </div>
  );
}

function State({ pending, error, children }: { pending: boolean; error: unknown; children: ReactNode }) {
  if (pending)
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-7 w-full" label="Loading from Aster" />
        <Skeleton className="h-7 w-full" />
      </div>
    );
  if (error) return <p className="m-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-[13px]">{explainAsterError(error)}</p>;
  return <>{children}</>;
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[12.5px]">
        <thead className="text-[11px] font-medium text-dim">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">{children}</tbody>
      </table>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-8 text-center text-[13px] text-muted">{children}</p>;

function Positions({ agent, symbol }: { agent: StoredAgent; symbol?: string }) {
  const q = usePositionRisk(agent);
  const rows = (q.data ?? []).filter((p) => Number(p.positionAmt) !== 0 && (!symbol || p.symbol === symbol));
  return (
    <>
      <State pending={q.isPending} error={q.error}>
        {rows.length === 0 ? (
          <Empty>No open positions{symbol ? ` on ${symbol}` : ""}. You&apos;re flat.</Empty>
        ) : (
          <Table head={["Market", "Size", "Entry", "Mark", "Liq. price", "Margin", "uPnL", "Lev / mode"]}>
            {rows.map((p) => (
              <tr key={`${p.symbol}${p.positionSide}`} className="border-t border-line-2">
                <td className="px-3 py-2 font-sans font-semibold">
                  {p.symbol} <span className={p.side === "LONG" ? "text-up" : "text-down"}>{p.side === "LONG" ? "Long" : "Short"}</span>
                </td>
                <td className="px-3 py-2 text-right">{trimDecimal(p.positionAmt.replace("-", ""))}</td>
                <td className="px-3 py-2 text-right">{trimDecimal(p.entryPrice)}</td>
                <td className="px-3 py-2 text-right">{num(p.markPrice, 4)}</td>
                <td className="px-3 py-2 text-right text-gold">{Number(p.liquidationPrice) > 0 ? num(p.liquidationPrice, 4) : "—"}</td>
                <td className="px-3 py-2 text-right">{num(p.margin)} USDT</td>
                <td className={`px-3 py-2 text-right ${pnlCls(p.unRealizedProfit)}`}>{num(p.unRealizedProfit)}</td>
                <td className="px-3 py-2 text-right">
                  {p.leverage}x · {p.marginType === "ISOLATED" ? "Isolated" : "Cross"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </State>
      <p className="px-3 pb-2 text-[11px] text-dim">Refreshed every 10s. Close a position with a reduce-only order in the ticket.</p>
    </>
  );
}

function OpenOrders({ agent, symbol }: { agent: StoredAgent; symbol?: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<number>();
  const [msg, setMsg] = useState<string>();
  const orders = useQuery({
    queryKey: ["aster-open-orders", agent.net, agent.signer],
    queryFn: async () => parseOpenOrders(await signedRequest(agent, "GET", "/fapi/v3/openOrders")),
    refetchInterval: 10_000,
    retry: false,
  });
  const rows = (orders.data ?? []).filter((o) => !symbol || o.symbol === symbol);

  async function cancel(sym: string, orderId: number) {
    setMsg(undefined);
    try {
      await signedRequest(agent, "DELETE", "/fapi/v3/order", cancelParams(sym, orderId));
      setMsg(`Cancelled order ${orderId}.`);
    } catch (e) {
      setMsg(explainAsterError(e));
    } finally {
      setConfirm(undefined);
      qc.invalidateQueries({ queryKey: ["aster-open-orders"] });
      qc.invalidateQueries({ queryKey: ["aster-order-history"] });
    }
  }

  return (
    <>
      <State pending={orders.isPending} error={orders.error}>
        {rows.length === 0 ? (
          <Empty>No open orders{symbol ? ` on ${symbol}` : ""}.</Empty>
        ) : (
          <Table head={["Market", "Type", "Price", "Trigger", "Filled / size", "Flags", "Time", ""]}>
            {rows.map((o) => (
              <tr key={o.orderId} className="border-t border-line-2">
                <td className="px-3 py-2 font-sans font-semibold">
                  {o.symbol} <span className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? "Buy" : "Sell"}</span>
                </td>
                <td className="px-3 py-2 text-right font-sans">{o.type}</td>
                <td className="px-3 py-2 text-right">{Number(o.price) > 0 ? trimDecimal(o.price) : "Market"}</td>
                <td className="px-3 py-2 text-right">{o.stopPrice && Number(o.stopPrice) > 0 ? trimDecimal(o.stopPrice) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {trimDecimal(o.executedQty)} / {trimDecimal(o.origQty)}
                </td>
                <td className="px-3 py-2 text-right font-sans text-muted">{o.reduceOnly ? "Reduce-only" : "—"}</td>
                <td className="px-3 py-2 text-right text-muted">{fmtTime(o.time)}</td>
                <td className="px-3 py-1.5 text-right font-sans">
                  {confirm === o.orderId ? (
                    <span className="inline-flex gap-1.5">
                      <Button tone="danger" size="sm" onClick={() => cancel(o.symbol, o.orderId)}>
                        Confirm
                      </Button>
                      <Button tone="line" size="sm" onClick={() => setConfirm(undefined)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button tone="line" size="sm" onClick={() => setConfirm(o.orderId)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </State>
      {msg ? (
        <p role="status" className="px-3 pb-2 text-[12.5px] font-medium">
          {msg}
        </p>
      ) : null}
    </>
  );
}

function OrderHistory({ agent, symbol }: { agent: StoredAgent; symbol: string }) {
  const q = useQuery({
    queryKey: ["aster-order-history", agent.net, agent.signer, symbol],
    queryFn: async () => parseOrderHistory(await signedRequest(agent, "GET", "/fapi/v3/allOrders", [["symbol", symbol], ["limit", "50"]])),
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <State pending={q.isPending} error={q.error}>
      {!q.data?.length ? (
        <Empty>No orders on {symbol} in the last 7 days.</Empty>
      ) : (
        <Table head={["Market", "Type", "Price", "Avg fill", "Filled / size", "Status", "Updated"]}>
          {q.data.map((o) => (
            <tr key={o.orderId} className="border-t border-line-2">
              <td className="px-3 py-2 font-sans font-semibold">
                {o.symbol} <span className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? "Buy" : "Sell"}</span>
              </td>
              <td className="px-3 py-2 text-right font-sans">
                {o.type}
                {o.reduceOnly ? " · RO" : ""}
              </td>
              <td className="px-3 py-2 text-right">{Number(o.price) > 0 ? trimDecimal(o.price) : o.stopPrice && Number(o.stopPrice) > 0 ? `@${trimDecimal(o.stopPrice)}` : "Market"}</td>
              <td className="px-3 py-2 text-right">{Number(o.avgPrice) > 0 ? trimDecimal(o.avgPrice) : "—"}</td>
              <td className="px-3 py-2 text-right">
                {trimDecimal(o.executedQty)} / {trimDecimal(o.origQty)}
              </td>
              <td className="px-3 py-2 text-right font-sans text-sub">{o.status}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtTime(o.updateTime ?? o.time)}</td>
            </tr>
          ))}
        </Table>
      )}
    </State>
  );
}

function TradeHistory({ agent, symbol }: { agent: StoredAgent; symbol: string }) {
  const q = useQuery({
    queryKey: ["aster-user-trades", agent.net, agent.signer, symbol],
    queryFn: async () => parseUserTrades(await signedRequest(agent, "GET", "/fapi/v3/userTrades", [["symbol", symbol], ["limit", "50"]])),
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <State pending={q.isPending} error={q.error}>
      {!q.data?.length ? (
        <Empty>No fills on {symbol} in the last 7 days.</Empty>
      ) : (
        <Table head={["Market", "Price", "Size", "Value", "Fee", "Realized PnL", "Role", "Time"]}>
          {q.data.map((t) => (
            <tr key={t.id} className="border-t border-line-2">
              <td className="px-3 py-2 font-sans font-semibold">
                {t.symbol} <span className={t.side === "BUY" ? "text-up" : "text-down"}>{t.side === "BUY" ? "Buy" : "Sell"}</span>
              </td>
              <td className="px-3 py-2 text-right">{trimDecimal(t.price)}</td>
              <td className="px-3 py-2 text-right">{trimDecimal(t.qty)}</td>
              <td className="px-3 py-2 text-right">{num(t.quoteQty)}</td>
              <td className="px-3 py-2 text-right text-muted">
                {num(t.commission, 4)} {t.commissionAsset}
              </td>
              <td className={`px-3 py-2 text-right ${pnlCls(t.realizedPnl)}`}>{num(t.realizedPnl)}</td>
              <td className="px-3 py-2 text-right font-sans text-muted">{t.maker ? "Maker" : "Taker"}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtTime(t.time)}</td>
            </tr>
          ))}
        </Table>
      )}
    </State>
  );
}
