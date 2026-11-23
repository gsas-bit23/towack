"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, Pill } from "@/components/ui";
import { explainAsterError, signedRequest, type StoredAgent } from "@/lib/aster/client";
import { trimDecimal, type AsterNet, type MarketRow, type SymbolRules } from "@/lib/aster/markets";
import {
  buildBracket,
  buildOrder,
  cleanDecimalInput,
  estMargin,
  floorToStep,
  hasLimitPrice,
  hasStopPrice,
  isMarketExec,
  leverageParams,
  marginTypeParams,
  ORDER_TYPE_LABEL,
  sizeFromPercent,
  type BuiltOrder,
  type MarginType,
  type OrderSide,
  type OrderType,
  type TimeInForce,
  type WorkingType,
} from "@/lib/aster/orders";
import { useAsterBalance, useHedgeMode, useMaxLeverage, usePositionRisk } from "./useAsterAccount";

export type OrderForm = {
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price: string;
  stopPrice: string;
  workingType: WorkingType;
  callbackRate: string;
  activationPrice: string;
  timeInForce: TimeInForce;
  /** "" = keep the leverage already set on Aster. */
  leverage: string;
  reduceOnly: boolean;
  tpsl: boolean;
  takeProfit: string;
  stopLoss: string;
};

export const EMPTY_FORM: OrderForm = {
  side: "BUY",
  type: "LIMIT",
  quantity: "",
  price: "",
  stopPrice: "",
  workingType: "CONTRACT_PRICE",
  callbackRate: "1",
  activationPrice: "",
  timeInForce: "GTC",
  leverage: "",
  reduceOnly: false,
  tpsl: false,
  takeProfit: "",
  stopLoss: "",
};

const CONDITIONAL: OrderType[] = ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"];
const TPSL_ENTRY: OrderType[] = ["LIMIT", "MARKET", "STOP", "STOP_MARKET"];
const PCTS = [25, 50, 75, 100] as const;

type Result = { ok: boolean; text: string } | undefined;

/** undefined = keep current leverage; NaN = invalid. */
export function parseLeverage(v: string, max = 125): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : NaN;
}

/** Everything the ticket would send, in order. Shared with the preview so what is shown is what is signed. */
export type TicketPlan = { leverage?: number; entry: BuiltOrder; legs: { leg: "TP" | "SL"; order: BuiltOrder }[] };

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
  const [sizeNote, setSizeNote] = useState<string>();
  const set = (patch: Partial<OrderForm>) => {
    setReview(false);
    setResult(undefined);
    setSizeNote(undefined);
    setForm({ ...form, ...patch });
  };

  const symbol = rules?.symbol ?? "";
  const balance = useAsterBalance(agent);
  const risk = usePositionRisk(agent);
  const hedge = useHedgeMode(agent);
  const maxLevQ = useMaxLeverage(agent, symbol);
  const maxLev = maxLevQ.data ?? 125;
  const posRow = risk.data?.find((p) => p.symbol === symbol && (p.positionSide === "BOTH" || p.positionSide === ""));
  const currentLev = posRow?.leverage;
  const currentMargin = posRow?.marginType;

  const offered = (t: OrderType) => (rules?.orderTypes.length ? rules.orderTypes.includes(t) : t === "LIMIT" || t === "MARKET");
  const t = form.type;
  const chosenLev = parseLeverage(form.leverage, maxLev);
  const levBad = Number.isNaN(chosenLev);
  const effLev = chosenLev && !levBad ? chosenLev : currentLev;
  const sendLev = chosenLev && !levBad && chosenLev !== currentLev ? chosenLev : undefined;

  const built = buildOrder(
    {
      symbol,
      side: form.side,
      type: t,
      quantity: form.quantity,
      price: form.price,
      stopPrice: form.stopPrice,
      callbackRate: form.callbackRate,
      activationPrice: form.activationPrice,
      workingType: hasStopPrice(t) || t === "TRAILING_STOP_MARKET" ? form.workingType : undefined,
      timeInForce: form.timeInForce,
      reduceOnly: form.reduceOnly,
      markPrice: row?.markPrice,
      lastPrice: row?.lastPrice,
    },
    rules,
  );
  const tpslAllowed = TPSL_ENTRY.includes(t) && !form.reduceOnly && offered("TAKE_PROFIT_MARKET") && offered("STOP_MARKET");
  const useTpsl = tpslAllowed && form.tpsl && Boolean(form.takeProfit || form.stopLoss);
  const entryRef = built.ok ? (built.order.price ?? built.order.stopPrice ?? row?.markPrice) : undefined;
  const bracket = useTpsl && built.ok
    ? buildBracket({ side: form.side, quantity: built.order.quantity, entryPrice: entryRef, takeProfit: form.takeProfit, stopLoss: form.stopLoss, workingType: form.workingType, markPrice: row?.markPrice, lastPrice: row?.lastPrice }, rules)
    : undefined;
  const plan: TicketPlan | undefined = built.ok && (!bracket || bracket.ok) ? { leverage: sendLev, entry: built.order, legs: bracket?.ok ? bracket.orders : [] } : undefined;
  const planError = !built.ok ? built.error : bracket && !bracket.ok ? bracket.error : undefined;
  const margin = estMargin(plan?.entry.notional, effLev);
  const base = rules?.base ?? "";
  const hedgeMode = hedge.data === true;

  const sizeDisabledNote = !agent
    ? "Connect an Aster API wallet to size from balance."
    : balance.isPending
      ? "Reading your USDT balance…"
      : !balance.data || Number(balance.data.available) <= 0
        ? "No available USDT margin on Aster."
        : undefined;

  function sizePct(pct: number) {
    if (!rules || !balance.data) return;
    const price = hasLimitPrice(t) ? form.price || row?.markPrice : hasStopPrice(t) ? form.stopPrice || row?.markPrice : row?.markPrice;
    const r = sizeFromPercent({ available: balance.data.available, pct, leverage: effLev ?? 1, price, type: t }, rules);
    if (r.ok) {
      setForm({ ...form, quantity: r.quantity });
      setReview(false);
      setSizeNote(`${pct}% of ${trimDecimal(balance.data.available)} USDT available × ${effLev ?? 1}x, before fees.`);
    } else setSizeNote(r.error);
  }

  async function send() {
    if (!agent || !plan || !rules) return;
    setBusy(true);
    setResult(undefined);
    const lines: string[] = [];
    try {
      if (plan.leverage) await signedRequest(agent, "POST", "/fapi/v3/leverage", leverageParams(rules.symbol, plan.leverage)!);
      const res = (await signedRequest(agent, "POST", "/fapi/v3/order", plan.entry.params)) as { orderId?: number; status?: string };
      lines.push(`Entry ${res?.orderId ?? ""} accepted by Aster${res?.status ? ` (${res.status})` : ""}.`);
      let legFail = false;
      for (const l of plan.legs) {
        try {
          const r = (await signedRequest(agent, "POST", "/fapi/v3/order", l.order.params)) as { orderId?: number };
          lines.push(`${l.leg} ${r?.orderId ?? ""} placed (reduce-only trigger ${l.order.stopPrice}).`);
        } catch (e) {
          legFail = true;
          lines.push(`${l.leg} was rejected: ${explainAsterError(e)} The entry is live without this ${l.leg}.`);
        }
      }
      setResult({ ok: !legFail, text: lines.join(" ") });
      setReview(false);
    } catch (e) {
      setResult({ ok: false, text: `${lines.join(" ")} ${explainAsterError(e)}`.trim() });
    } finally {
      setBusy(false);
      for (const k of ["aster-open-orders", "aster-balance", "aster-position-risk", "aster-order-history"]) qc.invalidateQueries({ queryKey: [k] });
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold tracking-tight">Order ticket</h2>
        <Pill tone={net === "testnet" ? "neutral" : "gold"}>{net === "testnet" ? "Aster testnet" : "Aster mainnet"}</Pill>
      </div>

      <MarginLev
        agent={agent}
        symbol={symbol}
        current={currentMargin}
        currentLev={currentLev}
        maxLev={maxLev}
        maxKnown={maxLevQ.data != null}
        value={form.leverage}
        onLev={(v) => set({ leverage: v })}
      />

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface p-1" role="tablist" aria-label="Side">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={form.side === s}
            onClick={() => set({ side: s })}
            className={`rounded-lg py-2 text-[14px] font-semibold ${form.side === s ? (s === "BUY" ? "bg-up text-[#0B0E11]" : "bg-down text-white") : "text-muted hover:text-fg"}`}
          >
            {s === "BUY" ? "Buy / Long" : "Sell / Short"}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Order type">
        {(["LIMIT", "MARKET"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={t === k}
            onClick={() => set({ type: k })}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${t === k ? "bg-card-2 text-fg" : "text-muted hover:text-fg"}`}
          >
            {ORDER_TYPE_LABEL[k]}
          </button>
        ))}
        <select
          aria-label="Conditional order type"
          value={CONDITIONAL.includes(t) ? t : ""}
          onChange={(e) => e.target.value && set({ type: e.target.value as OrderType })}
          className={`min-w-0 rounded-md border border-line bg-card px-2 py-1.5 text-[13px] font-semibold focus:border-gold focus:outline-none ${CONDITIONAL.includes(t) ? "text-fg" : "text-muted"}`}
        >
          <option value="">Conditional…</option>
          {CONDITIONAL.map((k) => (
            <option key={k} value={k} disabled={!offered(k)}>
              {ORDER_TYPE_LABEL[k]}
              {offered(k) ? "" : " (not on this market)"}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 space-y-2.5">
        {hasStopPrice(t) ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Num label="Trigger" unit="USDT" value={form.stopPrice} onChange={(v) => set({ stopPrice: v })} />
            <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
          </div>
        ) : null}
        {hasLimitPrice(t) ? (
          <Num
            label="Price"
            unit="USDT"
            value={form.price}
            onChange={(v) => set({ price: v })}
            extra={
              row?.markPrice ? (
                <button type="button" className="text-[11.5px] font-semibold text-gold hover:underline" onClick={() => set({ price: trimDecimal(rules ? floorToStep(row.markPrice!, rules.tickSize) : row.markPrice) })}>
                  Mark
                </button>
              ) : null
            }
          />
        ) : null}
        {t === "TRAILING_STOP_MARKET" ? (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Num label="Callback" unit="%" value={form.callbackRate} onChange={(v) => set({ callbackRate: v })} />
              <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
            </div>
            <Num label="Activation (optional)" unit="USDT" value={form.activationPrice} onChange={(v) => set({ activationPrice: v })} />
            <p className="text-[11.5px] text-dim">Callback 0.1–5%. Leave activation empty to start trailing from the current price.</p>
          </>
        ) : null}
        <Num label="Size" unit={base || "base"} value={form.quantity} onChange={(v) => set({ quantity: v })} />
        <div>
          <div className="grid grid-cols-4 gap-1">
            {PCTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={Boolean(sizeDisabledNote) || !rules}
                onClick={() => sizePct(p)}
                className="rounded-md border border-line py-1 font-mono text-[12px] text-sub hover:border-gold/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {p}%
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-dim">
            {sizeDisabledNote ??
              sizeNote ??
              (rules ? `Step ${trimDecimal(isMarketExec(t) ? rules.marketStepSize : rules.stepSize)} · min ${trimDecimal(isMarketExec(t) ? rules.marketMinQty : rules.minQty)} · min value ${trimDecimal(rules.minNotional)} ${rules.quote}` : "")}
          </p>
        </div>

        {hasLimitPrice(t) ? (
          <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
            Time in force
            <select
              className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-fg focus:border-gold focus:outline-none"
              value={form.timeInForce}
              onChange={(e) => set({ timeInForce: e.target.value as TimeInForce })}
              aria-label="Time in force"
            >
              <option value="GTC">GTC</option>
              <option value="IOC">IOC</option>
              {t === "LIMIT" ? <option value="GTX">Post-only (GTX)</option> : null}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-gold" checked={form.reduceOnly} onChange={(e) => set({ reduceOnly: e.target.checked })} />
          Reduce-only <span className="text-[11.5px] font-normal text-dim">close, never open or flip</span>
        </label>

        <div className={tpslAllowed ? "" : "opacity-60"}>
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" className="h-4 w-4 accent-gold" disabled={!tpslAllowed} checked={tpslAllowed && form.tpsl} onChange={(e) => set({ tpsl: e.target.checked })} />
            Attach TP / SL
          </label>
          {!tpslAllowed ? (
            <p className="mt-1 text-[11.5px] text-dim">
              {form.reduceOnly ? "Not with reduce-only orders." : !TPSL_ENTRY.includes(t) ? "Only for limit, market and stop entries." : "This market doesn't list TAKE_PROFIT_MARKET / STOP_MARKET."}
            </p>
          ) : form.tpsl ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Num label="Take profit" unit="" value={form.takeProfit} onChange={(v) => set({ takeProfit: v })} />
                <Num label="Stop loss" unit="" value={form.stopLoss} onChange={(v) => set({ stopLoss: v })} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-dim">Reduce-only market triggers, same size, opposite side.</span>
                <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
              </div>
            </div>
          ) : null}
        </div>
        {effLev && effLev > 10 ? <p className="text-[12px] font-medium text-down">High leverage: a small move against you can liquidate the position.</p> : null}
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        {plan ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px] text-sub">
            <dt>Size</dt>
            <dd className="text-right font-mono tabular-nums">
              {plan.entry.quantity} {base}
            </dd>
            {plan.entry.stopPrice ? (
              <>
                <dt>Trigger</dt>
                <dd className="text-right font-mono tabular-nums">{plan.entry.stopPrice}</dd>
              </>
            ) : null}
            {plan.entry.price ? (
              <>
                <dt>Price</dt>
                <dd className="text-right font-mono tabular-nums">{plan.entry.price}</dd>
              </>
            ) : null}
            <dt>Value ≈</dt>
            <dd className="text-right font-mono tabular-nums">{plan.entry.notional !== undefined ? `${plan.entry.notional.toFixed(2)} USDT` : "—"}</dd>
            <dt>Margin ≈ {effLev ? `at ${effLev}x` : ""}</dt>
            <dd className="text-right font-mono tabular-nums">{margin !== undefined ? `${margin.toFixed(2)} USDT` : agent ? "—" : "set leverage"}</dd>
            <dt className="col-span-2 mt-2 text-[11px] font-medium uppercase tracking-[.08em] text-muted">Exact requests, signed by your API wallet, sent one by one</dt>
            <dd className="col-span-2 space-y-1 break-all font-mono text-[11px] leading-snug text-fg">
              {plan.leverage ? <div className="rounded-md bg-card px-2 py-1">POST /fapi/v3/leverage symbol={symbol}&leverage={plan.leverage}</div> : null}
              <div className="rounded-md bg-card px-2 py-1">POST /fapi/v3/order {plan.entry.params.map(([k, v]) => `${k}=${v}`).join("&")}</div>
              {plan.legs.map((l) => (
                <div key={l.leg} className="rounded-md bg-card px-2 py-1">
                  {l.leg}: POST /fapi/v3/order {l.order.params.map(([k, v]) => `${k}=${v}`).join("&")}
                </div>
              ))}
            </dd>
            {plan.legs.length ? (
              <dd className="col-span-2 mt-1 text-[11px] text-dim">
                Sequential, not batchOrders: TP / SL are sent only after Aster accepts the entry. If a limit entry fills later, they stay as reduce-only triggers.
              </dd>
            ) : null}
          </dl>
        ) : (
          <p className="text-[12.5px] text-muted">{planError ?? ""}</p>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {!agent ? (
          <Button tone="soft" size="md" className="w-full" onClick={onNeedAgent}>
            Set up your Aster API wallet to trade
          </Button>
        ) : hedgeMode ? (
          <p className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px]">
            Your Aster account is in <b>Hedge mode</b>. This terminal sends one-way (BOTH) orders only. Switch to One-way mode on Aster to trade here.
          </p>
        ) : !review ? (
          <button
            type="button"
            disabled={!plan || levBad}
            onClick={() => setReview(true)}
            className={`press h-11 w-full rounded-[10px] text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${form.side === "BUY" ? "bg-up text-[#0B0E11]" : "bg-down text-white"}`}
          >
            Review {form.side === "BUY" ? "long" : "short"}
          </button>
        ) : (
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
            <p className="text-[13px] font-medium">
              Send this {ORDER_TYPE_LABEL[t].toLowerCase()} {form.side === "BUY" ? "long" : "short"} of {plan?.entry.quantity} {base}
              {plan?.entry.price ? ` at ${plan.entry.price}` : ""}
              {plan?.entry.stopPrice ? `, trigger ${plan.entry.stopPrice}` : ""} to Aster{plan?.leverage ? ` at ${plan.leverage}x` : ""}
              {plan?.legs.length ? ` with ${plan.legs.map((l) => l.leg).join(" + ")}` : ""}? Your API wallet signs in this browser; nothing goes to Towack.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button tone="gold" size="sm" disabled={busy || !plan} onClick={send}>
                {busy ? "Sending…" : "Yes, sign & send"}
              </Button>
              <Button tone="line" size="sm" disabled={busy} onClick={() => setReview(false)}>
                Back
              </Button>
            </div>
          </div>
        )}
        {result ? (
          <p role="status" className={`rounded-lg border px-3 py-2 text-[12.5px] font-medium ${result.ok ? "border-line bg-card" : "border-down/30 bg-down/10"}`}>
            {result.text}
          </p>
        ) : null}
      </div>
      <p className="mt-3 text-[11.5px] text-dim">
        One-way mode (positionSide BOTH). Perps are leveraged: you can lose your whole margin and be liquidated. Orders go to Aster, not Towack. Towack adds no fee.
      </p>
    </div>
  );
}

function Num({ label, unit, value, onChange, extra }: { label: string; unit: string; value: string; onChange: (v: string) => void; extra?: ReactNode }) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-line-2 bg-card-2 px-3 py-2 focus-within:border-gold hover:border-gold/40">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-[14px] tabular-nums text-fg placeholder:text-dim focus:outline-none"
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(e) => onChange(cleanDecimalInput(e.target.value))}
        aria-label={label}
      />
      {unit ? <span className="shrink-0 text-[11.5px] text-dim">{unit}</span> : null}
      {extra}
    </label>
  );
}

function TriggerBy({ value, onChange }: { value: WorkingType; onChange: (w: WorkingType) => void }) {
  return (
    <select
      aria-label="Trigger price type"
      value={value}
      onChange={(e) => onChange(e.target.value as WorkingType)}
      className="rounded-lg border border-line-2 bg-card-2 px-2 text-[12px] text-sub focus:border-gold focus:outline-none"
    >
      <option value="CONTRACT_PRICE">Last</option>
      <option value="MARK_PRICE">Mark</option>
    </select>
  );
}

/** Cross / Isolated (POST /fapi/v3/marginType) and the leverage slider (sent as POST /fapi/v3/leverage before the order). */
function MarginLev({
  agent,
  symbol,
  current,
  currentLev,
  maxLev,
  maxKnown,
  value,
  onLev,
}: {
  agent: StoredAgent | undefined;
  symbol: string;
  current: MarginType | undefined;
  currentLev: number | undefined;
  maxLev: number;
  maxKnown: boolean;
  value: string;
  onLev: (v: string) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<MarginType>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const shown = Number(value) || currentLev || Math.min(10, maxLev);

  async function switchMode(m: MarginType) {
    if (!agent || !symbol) return;
    setBusy(true);
    setNote(undefined);
    try {
      await signedRequest(agent, "POST", "/fapi/v3/marginType", marginTypeParams(symbol, m));
      setNote(`${symbol} is now ${m === "ISOLATED" ? "isolated" : "cross"} margin.`);
    } catch (e) {
      setNote(`Aster kept the current mode: ${explainAsterError(e)}`);
    } finally {
      setBusy(false);
      setPending(undefined);
      qc.invalidateQueries({ queryKey: ["aster-position-risk"] });
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface p-1" role="group" aria-label="Margin mode">
          {(["CROSSED", "ISOLATED"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!agent || !current || busy}
              aria-pressed={current === m}
              onClick={() => current !== m && setPending(m)}
              className={`rounded-md py-1 text-[12.5px] font-semibold disabled:cursor-not-allowed ${current === m ? "bg-card-2 text-fg" : "text-muted hover:text-fg"} ${!agent || !current ? "opacity-50" : ""}`}
            >
              {m === "CROSSED" ? "Cross" : "Isolated"}
            </button>
          ))}
        </div>
      </div>
      {pending ? (
        <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-[12px]">
          <span className="font-mono">POST /fapi/v3/marginType symbol={symbol}&marginType={pending}</span>
          <div className="mt-1.5 flex gap-2">
            <Button tone="gold" size="sm" disabled={busy} onClick={() => switchMode(pending)}>
              {busy ? "Sending…" : `Switch to ${pending === "ISOLATED" ? "isolated" : "cross"}`}
            </Button>
            <Button tone="line" size="sm" disabled={busy} onClick={() => setPending(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {!agent ? <p className="text-[11.5px] text-dim">Margin mode and current leverage are read from your Aster account once an API wallet is set up.</p> : note ? <p className="text-[11.5px] text-sub">{note}</p> : null}

      <div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-muted">Leverage</span>
          <span className="font-mono tabular-nums">
            {shown}x
            <span className="ml-1 text-[11px] text-dim">{value ? (currentLev && Number(value) === currentLev ? "(current)" : `(was ${currentLev ? `${currentLev}x` : "—"})`) : currentLev ? "(current)" : "(unchanged)"}</span>
            {value ? (
              <button type="button" className="ml-2 text-[11px] text-gold hover:underline" onClick={() => onLev("")}>
                reset
              </button>
            ) : null}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={maxLev}
          step={1}
          value={Math.min(shown, maxLev)}
          onChange={(e) => onLev(e.target.value)}
          aria-label="Leverage"
          className="mt-1 w-full accent-gold"
        />
        <div className="flex justify-between font-mono text-[10.5px] text-dim">
          <span>1x</span>
          <span>
            {maxLev}x {maxKnown ? "max" : "cap"}
          </span>
        </div>
      </div>
    </div>
  );
}
