"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Field, Panel, Pill, inputClass } from "@/components/ui";
import { explainAsterError, signedRequest, type StoredAgent } from "@/lib/aster/client";
import { trimDecimal, type AsterNet, type MarketRow, type SymbolRules } from "@/lib/aster/markets";
import { buildOrder, cleanDecimalInput, floorToStep, leverageParams, type OrderSide, type OrderType, type TimeInForce } from "@/lib/aster/orders";

export type OrderForm = {
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price: string;
  timeInForce: TimeInForce;
  leverage: string;
  reduceOnly: boolean;
};

export const EMPTY_FORM: OrderForm = { side: "BUY", type: "LIMIT", quantity: "", price: "", timeInForce: "GTC", leverage: "", reduceOnly: false };

type Result = { ok: boolean; text: string } | undefined;

/** undefined = keep current leverage; NaN = invalid. */
export function parseLeverage(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 125 ? n : NaN;
}

export function OrderTicket({
  net,
  row,
  rules,
  agent,
  form,
  setForm,
  onNeedAgent,
}: {
  net: AsterNet;
  row: MarketRow | undefined;
  rules: SymbolRules | undefined;
  agent: StoredAgent | undefined;
  form: OrderForm;
  setForm: (f: OrderForm) => void;
  onNeedAgent: () => void;
}) {
  const qc = useQueryClient();
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const set = (patch: Partial<OrderForm>) => {
    setReview(false);
    setResult(undefined);
    setForm({ ...form, ...patch });
  };

  const lev = parseLeverage(form.leverage);
  const levBad = Number.isNaN(lev);
  const built = buildOrder(
    { symbol: rules?.symbol ?? "", side: form.side, type: form.type, quantity: form.quantity, price: form.price, timeInForce: form.timeInForce, reduceOnly: form.reduceOnly, markPrice: row?.markPrice },
    rules,
  );
  const order = built.ok ? built.order : undefined;
  const margin = order?.notional !== undefined && lev ? order.notional / lev : undefined;
  const base = rules?.base ?? "";

  async function send() {
    if (!agent || !order || !rules) return;
    setBusy(true);
    setResult(undefined);
    try {
      if (lev) await signedRequest(agent, "POST", "/fapi/v3/leverage", leverageParams(rules.symbol, lev)!);
      const res = (await signedRequest(agent, "POST", "/fapi/v3/order", order.params)) as { orderId?: number; status?: string };
      setResult({ ok: true, text: `Order ${res?.orderId ?? ""} accepted by Aster${res?.status ? ` (${res.status})` : ""}.` });
      setReview(false);
      qc.invalidateQueries({ queryKey: ["aster-open-orders"] });
      qc.invalidateQueries({ queryKey: ["aster-balance"] });
    } catch (e) {
      setResult({ ok: false, text: explainAsterError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-semibold">Order ticket</h2>
        <Pill tone={net === "testnet" ? "neutral" : "gold"}>{net === "testnet" ? "ASTER TESTNET" : "ASTER MAINNET"}</Pill>
      </div>
      <p className="mt-1 font-medium text-sub">{rules ? `${rules.symbol} perpetual · margin in ${rules.quote}` : "Pick a market."}</p>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label="Side">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={form.side === s}
            onClick={() => set({ side: s })}
            className={`rounded-full py-2 font-display text-[17px] font-semibold ${form.side === s ? (s === "BUY" ? "bg-card-2" : "bg-gold/10 text-fg") : "text-muted"}`}
          >
            {s === "BUY" ? "Long / Buy" : "Short / Sell"}
          </button>
        ))}
      </div>

      <div className="mt-3 inline-flex rounded-full border border-line bg-card p-1" role="tablist" aria-label="Order type">
        {(["LIMIT", "MARKET"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={form.type === t}
            onClick={() => set({ type: t })}
            className={`rounded-full px-5 py-1.5 font-display text-[15px] font-semibold ${form.type === t ? "bg-card-2 text-fg" : "text-muted"}`}
          >
            {t === "LIMIT" ? "Limit" : "Market"}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <Field label={`Size (${base || "base"})`} hint={rules ? `Step ${trimDecimal(form.type === "MARKET" ? rules.marketStepSize : rules.stepSize)} · min ${trimDecimal(form.type === "MARKET" ? rules.marketMinQty : rules.minQty)} · min value ${trimDecimal(rules.minNotional)} ${rules.quote}` : undefined}>
          <input className={inputClass} inputMode="decimal" placeholder="0.0" value={form.quantity} onChange={(e) => set({ quantity: cleanDecimalInput(e.target.value) })} aria-label="Order size" />
        </Field>
        {form.type === "LIMIT" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Limit price (USDT)" hint={row?.markPrice ? `Mark ${trimDecimal(row.markPrice)} · tick ${trimDecimal(rules?.tickSize)}` : undefined}>
              <div className="flex gap-2">
                <input className={inputClass} inputMode="decimal" placeholder="0.0" value={form.price} onChange={(e) => set({ price: cleanDecimalInput(e.target.value) })} aria-label="Limit price" />
                {row?.markPrice ? (
                  <Button tone="line" size="sm" onClick={() => set({ price: trimDecimal(rules ? floorToStep(row.markPrice!, rules.tickSize) : row.markPrice) })}>
                    Mark
                  </Button>
                ) : null}
              </div>
            </Field>
            <Field label="Time in force">
              <select className={`${inputClass} !text-[17px]`} value={form.timeInForce} onChange={(e) => set({ timeInForce: e.target.value as TimeInForce })} aria-label="Time in force">
                <option value="GTC">GTC</option>
                <option value="IOC">IOC</option>
                <option value="GTX">Post-only</option>
              </select>
            </Field>
          </div>
        ) : (
          <p className="rounded-2xl border border-line bg-gold/5 px-4 py-2 text-sm font-medium">Market orders fill at the book price and can slip. Value is checked at mark price.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Leverage" hint={levBad ? "Whole number 1–125." : "Blank keeps your current Aster leverage."}>
            <input className={inputClass} inputMode="numeric" placeholder="e.g. 3" value={form.leverage} onChange={(e) => set({ leverage: e.target.value.replace(/[^0-9]/g, "") })} aria-label="Leverage" />
          </Field>
          <label className="mt-7 flex items-start gap-3 font-medium">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={form.reduceOnly} onChange={(e) => set({ reduceOnly: e.target.checked })} />
            <span>Reduce-only (close, never open or flip)</span>
          </label>
        </div>
        {lev && lev > 10 ? <p className="font-medium text-down">High leverage: a small move against you can liquidate the position.</p> : null}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card-2 p-5">
        <div className="text-[13px] font-semibold uppercase tracking-widest text-muted">Order preview</div>
        {order ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-medium text-sub">
            <dt>Size</dt>
            <dd className="text-right">
              {order.quantity} {base}
            </dd>
            {order.price ? (
              <>
                <dt>Price</dt>
                <dd className="text-right">{order.price} USDT</dd>
              </>
            ) : null}
            <dt>Value (≈)</dt>
            <dd className="text-right">{order.notional !== undefined ? `${order.notional.toFixed(2)} USDT` : "—"}</dd>
            {margin !== undefined ? (
              <>
                <dt>Margin at {lev}x (≈)</dt>
                <dd className="text-right">{margin.toFixed(2)} USDT</dd>
              </>
            ) : null}
            <dt className="col-span-2 mt-2 text-xs uppercase tracking-widest text-muted">Exact request signed by your API wallet</dt>
            <dd className="col-span-2 break-all rounded-xl bg-card px-3 py-2 font-mono text-[12.5px]">
              {lev ? `POST /fapi/v3/leverage leverage=${lev} → ` : ""}POST /fapi/v3/order {order.params.map(([k, v]) => `${k}=${v}`).join("&")}
            </dd>
          </dl>
        ) : (
          <p className="mt-1 font-medium text-muted">{built.ok ? "" : built.error}</p>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {!agent ? (
          <Button tone="soft" size="lg" className="w-full" onClick={onNeedAgent}>
            Set up your Aster API wallet to trade
          </Button>
        ) : !review ? (
          <Button tone={form.side === "BUY" ? "soft" : "gold"} size="lg" className="w-full" disabled={!order || levBad} onClick={() => setReview(true)}>
            Review {form.side === "BUY" ? "long" : "short"}
          </Button>
        ) : (
          <div className="rounded-2xl border border-line bg-gold/5 p-4">
            <p className="font-medium">
              Send this {form.type.toLowerCase()} {form.side === "BUY" ? "long" : "short"} of {order?.quantity} {base}
              {order?.price ? ` at ${order.price}` : ""} to Aster{lev ? ` at ${lev}x` : ""}? Your API wallet signs it in this browser; nothing goes to Towack.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button tone={form.side === "BUY" ? "soft" : "gold"} size="md" disabled={busy || !order} onClick={send}>
                {busy ? "Sending…" : "Yes, sign & send"}
              </Button>
              <Button tone="line" size="md" disabled={busy} onClick={() => setReview(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
        {result ? (
          <p role="status" className={`rounded-2xl border border-line px-4 py-3 font-medium ${result.ok ? "bg-card" : "bg-down/10"}`}>
            {result.text}
          </p>
        ) : null}
      </div>
      <p className="mt-6 text-sm font-semibold text-muted">
        Perps are leveraged and risky: you can lose your whole margin, and positions can be liquidated. Orders go to Aster, not Towack. Towack adds no fee.
      </p>
    </Panel>
  );
}
