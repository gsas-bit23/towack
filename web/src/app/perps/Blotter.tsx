"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/motion";
import { Button } from "@/components/ui";
import { explainAsterError, signedRequest, type StoredAgent } from "@/lib/aster/client";
import { trimDecimal } from "@/lib/aster/markets";
import { cancelParams, parseOpenOrders, parseOrderHistory, parseUserTrades } from "@/lib/aster/orders";
import { usePositionRisk } from "./useAsterAccount";
import { useLocale, type MessageKey } from "@/lib/i18n";

type Tab = "positions" | "open" | "history" | "trades";
const TABS: [Tab, MessageKey][] = [
  ["positions", "perps.bl.positions"],
  ["open", "perps.bl.open"],
  ["history", "perps.bl.history"],
  ["trades", "perps.bl.trades"],
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
  const { t } = useLocale();
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3">
        <div className="-mb-px flex min-w-0 flex-wrap" role="tablist" aria-label={t("perps.accountAria")}>
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`border-b-2 px-2.5 py-2.5 text-[13px] font-semibold sm:px-3 ${tab === k ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg"}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
        {agent && (tab === "open" || tab === "positions") ? (
          <label className="flex items-center gap-2 py-2 text-[12px] text-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-gold" checked={allSymbols} onChange={(e) => setAllSymbols(e.target.checked)} />
            {t("perps.bl.all")}
          </label>
        ) : agent ? (
          <span className="py-2 text-[12px] text-dim">{t("perps.bl.last7", { symbol })}</span>
        ) : null}
      </div>
      <div className="min-h-[140px]">
        {!agent ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="max-w-[420px] text-[13.5px] text-sub">{t("perps.bl.setupBody")}</p>
            <Button tone="soft" size="sm" onClick={onNeedAgent}>
              {t("perps.bl.setup")}
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
  const { t } = useLocale();
  if (pending)
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-7 w-full" label={t("perps.bl.loading")} />
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
  const { t } = useLocale();
  return (
    <>
      <State pending={q.isPending} error={q.error}>
        {rows.length === 0 ? (
          <Empty>{symbol ? t("perps.bl.noPosOn", { symbol }) : t("perps.bl.noPos")}</Empty>
        ) : (
          <Table head={[t("perps.bl.market"), t("perps.bl.size"), t("perps.bl.entry"), t("perps.bl.mark"), t("perps.bl.liq"), t("perps.bl.margin"), t("perps.bl.upnl"), t("perps.bl.levMode")]}>
            {rows.map((p) => (
              <tr key={`${p.symbol}${p.positionSide}`} className="border-t border-line-2">
                <td className="px-3 py-2 font-sans font-semibold">
                  {p.symbol} <span className={p.side === "LONG" ? "text-up" : "text-down"}>{p.side === "LONG" ? t("perps.bl.long") : t("perps.bl.short")}</span>
                </td>
                <td className="px-3 py-2 text-right">{trimDecimal(p.positionAmt.replace("-", ""))}</td>
                <td className="px-3 py-2 text-right">{trimDecimal(p.entryPrice)}</td>
                <td className="px-3 py-2 text-right">{num(p.markPrice, 4)}</td>
                <td className="px-3 py-2 text-right text-gold">{Number(p.liquidationPrice) > 0 ? num(p.liquidationPrice, 4) : "—"}</td>
                <td className="px-3 py-2 text-right">{num(p.margin)} USDT</td>
                <td className={`px-3 py-2 text-right ${pnlCls(p.unRealizedProfit)}`}>{num(p.unRealizedProfit)}</td>
                <td className="px-3 py-2 text-right">
                  {p.leverage}x · {p.marginType === "ISOLATED" ? t("perps.t.isolated") : t("perps.t.cross")}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </State>
      <p className="px-3 pb-2 text-[11px] text-dim">{t("perps.bl.refresh")}</p>
    </>
  );
}

function OpenOrders({ agent, symbol }: { agent: StoredAgent; symbol?: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<number>();
  const [msg, setMsg] = useState<string>();
  const { t } = useLocale();
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
      setMsg(t("perps.bl.cancelled", { id: orderId }));
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
          <Empty>{symbol ? t("perps.bl.noOpenOn", { symbol }) : t("perps.bl.noOpen")}</Empty>
        ) : (
          <Table head={[t("perps.bl.market"), t("perps.bl.type"), t("perps.bl.price"), t("perps.bl.trigger"), t("perps.bl.filled"), t("perps.bl.flags"), t("perps.bl.time"), ""]}>
            {rows.map((o) => (
              <tr key={o.orderId} className="border-t border-line-2">
                <td className="px-3 py-2 font-sans font-semibold">
                  {o.symbol} <span className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? t("perps.bl.buy") : t("perps.bl.sell")}</span>
                </td>
                <td className="px-3 py-2 text-right font-sans">{o.type}</td>
                <td className="px-3 py-2 text-right">{Number(o.price) > 0 ? trimDecimal(o.price) : t("perps.bl.marketPx")}</td>
                <td className="px-3 py-2 text-right">{o.stopPrice && Number(o.stopPrice) > 0 ? trimDecimal(o.stopPrice) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {trimDecimal(o.executedQty)} / {trimDecimal(o.origQty)}
                </td>
                <td className="px-3 py-2 text-right font-sans text-muted">{o.reduceOnly ? t("perps.t.reduceOnly") : "—"}</td>
                <td className="px-3 py-2 text-right text-muted">{fmtTime(o.time)}</td>
                <td className="px-3 py-1.5 text-right font-sans">
                  {confirm === o.orderId ? (
                    <span className="inline-flex gap-1.5">
                      <Button tone="danger" size="sm" onClick={() => cancel(o.symbol, o.orderId)}>
                        {t("perps.bl.confirm")}
                      </Button>
                      <Button tone="line" size="sm" onClick={() => setConfirm(undefined)}>
                        {t("perps.bl.keep")}
                      </Button>
                    </span>
                  ) : (
                    <Button tone="line" size="sm" onClick={() => setConfirm(o.orderId)}>
                      {t("perps.bl.cancel")}
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
  const { t } = useLocale();
  return (
    <State pending={q.isPending} error={q.error}>
      {!q.data?.length ? (
        <Empty>{t("perps.bl.noHist", { symbol })}</Empty>
      ) : (
        <Table head={[t("perps.bl.market"), t("perps.bl.type"), t("perps.bl.price"), t("perps.bl.avgFill"), t("perps.bl.filled"), t("perps.bl.status"), t("perps.bl.updated")]}>
          {q.data.map((o) => (
            <tr key={o.orderId} className="border-t border-line-2">
              <td className="px-3 py-2 font-sans font-semibold">
                {o.symbol} <span className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? t("perps.bl.buy") : t("perps.bl.sell")}</span>
              </td>
              <td className="px-3 py-2 text-right font-sans">
                {o.type}
                {o.reduceOnly ? " · RO" : ""}
              </td>
              <td className="px-3 py-2 text-right">{Number(o.price) > 0 ? trimDecimal(o.price) : o.stopPrice && Number(o.stopPrice) > 0 ? `@${trimDecimal(o.stopPrice)}` : t("perps.bl.marketPx")}</td>
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
  const { t: tr } = useLocale();
  return (
    <State pending={q.isPending} error={q.error}>
      {!q.data?.length ? (
        <Empty>{tr("perps.bl.noFills", { symbol })}</Empty>
      ) : (
        <Table head={[tr("perps.bl.market"), tr("perps.bl.price"), tr("perps.bl.size"), tr("perps.bl.value"), tr("perps.bl.fee"), tr("perps.bl.pnl"), tr("perps.bl.role"), tr("perps.bl.time")]}>
          {q.data.map((t) => (
            <tr key={t.id} className="border-t border-line-2">
              <td className="px-3 py-2 font-sans font-semibold">
                {t.symbol} <span className={t.side === "BUY" ? "text-up" : "text-down"}>{t.side === "BUY" ? tr("perps.bl.buy") : tr("perps.bl.sell")}</span>
              </td>
              <td className="px-3 py-2 text-right">{trimDecimal(t.price)}</td>
              <td className="px-3 py-2 text-right">{trimDecimal(t.qty)}</td>
              <td className="px-3 py-2 text-right">{num(t.quoteQty)}</td>
              <td className="px-3 py-2 text-right text-muted">
                {num(t.commission, 4)} {t.commissionAsset}
              </td>
              <td className={`px-3 py-2 text-right ${pnlCls(t.realizedPnl)}`}>{num(t.realizedPnl)}</td>
              <td className="px-3 py-2 text-right font-sans text-muted">{t.maker ? tr("perps.bl.maker") : tr("perps.bl.taker")}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtTime(t.time)}</td>
            </tr>
          ))}
        </Table>
      )}
    </State>
  );
}
