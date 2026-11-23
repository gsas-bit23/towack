"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, Pill } from "@/components/ui";
import { explainAsterError, signedRequest, type StoredAgent } from "@/lib/aster/client";
import { trimDecimal, type MarketRow, type SymbolRules } from "@/lib/aster/markets";
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
  sizeFromPercent,
  type BuiltOrder,
  type MarginType,
  type OrderSide,
  type OrderType,
  type TimeInForce,
  type WorkingType,
} from "@/lib/aster/orders";
import { useAsterBalance, useHedgeMode, useMaxLeverage, usePositionRisk } from "./useAsterAccount";
import { useLocale, type MessageKey } from "@/lib/i18n";

const otKey = (type: OrderType) => `perps.ot.${type}` as MessageKey;

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
  row,
  rules,
  agent,
  form,
  setForm,
  onNeedAgent,
}: {
  row: MarketRow | undefined;
  rules: SymbolRules | undefined;
  agent: StoredAgent | undefined;
  form: OrderForm;
  setForm: (f: OrderForm) => void;
  onNeedAgent: () => void;
}) {
  const qc = useQueryClient();
  const { t: tr, rich } = useLocale();
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
    ? tr("perps.t.noAgentSize")
    : balance.isPending
      ? tr("perps.t.readingBal")
      : !balance.data || Number(balance.data.available) <= 0
        ? tr("perps.t.noMargin")
        : undefined;

  function sizePct(pct: number) {
    if (!rules || !balance.data) return;
    const price = hasLimitPrice(t) ? form.price || row?.markPrice : hasStopPrice(t) ? form.stopPrice || row?.markPrice : row?.markPrice;
    const r = sizeFromPercent({ available: balance.data.available, pct, leverage: effLev ?? 1, price, type: t }, rules);
    if (r.ok) {
      setForm({ ...form, quantity: r.quantity });
      setReview(false);
      setSizeNote(tr("perps.t.sizeNote", { pct, avail: trimDecimal(balance.data.available), lev: effLev ?? 1 }));
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
      lines.push(tr("perps.t.entryOk", { id: res?.orderId ?? "", status: res?.status ? ` (${res.status})` : "" }));
      let legFail = false;
      for (const l of plan.legs) {
        try {
          const r = (await signedRequest(agent, "POST", "/fapi/v3/order", l.order.params)) as { orderId?: number };
          lines.push(tr("perps.t.legOk", { leg: l.leg, id: r?.orderId ?? "", p: l.order.stopPrice ?? "" }));
        } catch (e) {
          legFail = true;
          lines.push(tr("perps.t.legFail", { leg: l.leg, e: explainAsterError(e) }));
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
        <h2 className="text-[16px] font-semibold tracking-tight">{tr("perps.t.title")}</h2>
        <Pill tone="gold">Aster</Pill>
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

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface p-1" role="tablist" aria-label={tr("perps.t.sideAria")}>
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={form.side === s}
            onClick={() => set({ side: s })}
            className={`rounded-lg py-2 text-[14px] font-semibold ${form.side === s ? (s === "BUY" ? "bg-up text-[#0B0E11]" : "bg-down text-white") : "text-muted hover:text-fg"}`}
          >
            {s === "BUY" ? tr("perps.buyLong") : tr("perps.sellShort")}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label={tr("perps.t.typeAria")}>
        {(["LIMIT", "MARKET"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={t === k}
            onClick={() => set({ type: k })}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${t === k ? "bg-card-2 text-fg" : "text-muted hover:text-fg"}`}
          >
            {tr(otKey(k))}
          </button>
        ))}
        <select
          aria-label={tr("perps.t.condAria")}
          value={CONDITIONAL.includes(t) ? t : ""}
          onChange={(e) => e.target.value && set({ type: e.target.value as OrderType })}
          className={`min-w-0 rounded-md border border-line bg-card px-2 py-1.5 text-[13px] font-semibold focus:border-gold focus:outline-none ${CONDITIONAL.includes(t) ? "text-fg" : "text-muted"}`}
        >
          <option value="">{tr("perps.t.conditional")}</option>
          {CONDITIONAL.map((k) => (
            <option key={k} value={k} disabled={!offered(k)}>
              {tr(otKey(k))}
              {offered(k) ? "" : tr("perps.t.notOnMarket")}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 space-y-2.5">
        {hasStopPrice(t) ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Num label={tr("perps.t.trigger")} unit="USDT" value={form.stopPrice} onChange={(v) => set({ stopPrice: v })} />
            <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
          </div>
        ) : null}
        {hasLimitPrice(t) ? (
          <Num
            label={tr("perps.t.price")}
            unit="USDT"
            value={form.price}
            onChange={(v) => set({ price: v })}
            extra={
              row?.markPrice ? (
                <button type="button" className="text-[11.5px] font-semibold text-gold hover:underline" onClick={() => set({ price: trimDecimal(rules ? floorToStep(row.markPrice!, rules.tickSize) : row.markPrice) })}>
                  {tr("perps.t.markBtn")}
                </button>
              ) : null
            }
          />
        ) : null}
        {t === "TRAILING_STOP_MARKET" ? (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Num label={tr("perps.t.callback")} unit="%" value={form.callbackRate} onChange={(v) => set({ callbackRate: v })} />
              <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
            </div>
            <Num label={tr("perps.t.activation")} unit="USDT" value={form.activationPrice} onChange={(v) => set({ activationPrice: v })} />
            <p className="text-[11.5px] text-dim">{tr("perps.t.trailNote")}</p>
          </>
        ) : null}
        <Num label={tr("perps.t.size")} unit={base || tr("perps.t.base")} value={form.quantity} onChange={(v) => set({ quantity: v })} />
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
              (rules
                ? tr("perps.t.rules", {
                    step: trimDecimal(isMarketExec(t) ? rules.marketStepSize : rules.stepSize),
                    min: trimDecimal(isMarketExec(t) ? rules.marketMinQty : rules.minQty),
                    minVal: trimDecimal(rules.minNotional),
                    quote: rules.quote,
                  })
                : "")}
          </p>
        </div>

        {hasLimitPrice(t) ? (
          <label className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
            {tr("perps.t.tif")}
            <select
              className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-fg focus:border-gold focus:outline-none"
              value={form.timeInForce}
              onChange={(e) => set({ timeInForce: e.target.value as TimeInForce })}
              aria-label={tr("perps.t.tif")}
            >
              <option value="GTC">GTC</option>
              <option value="IOC">IOC</option>
              {t === "LIMIT" ? <option value="GTX">{tr("perps.t.postOnly")}</option> : null}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-gold" checked={form.reduceOnly} onChange={(e) => set({ reduceOnly: e.target.checked })} />
          {tr("perps.t.reduceOnly")} <span className="text-[11.5px] font-normal text-dim">{tr("perps.t.reduceOnlyNote")}</span>
        </label>

        <div className={tpslAllowed ? "" : "opacity-60"}>
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" className="h-4 w-4 accent-gold" disabled={!tpslAllowed} checked={tpslAllowed && form.tpsl} onChange={(e) => set({ tpsl: e.target.checked })} />
            {tr("perps.t.attach")}
          </label>
          {!tpslAllowed ? (
            <p className="mt-1 text-[11.5px] text-dim">
              {form.reduceOnly ? tr("perps.t.noReduce") : !TPSL_ENTRY.includes(t) ? tr("perps.t.onlyEntries") : tr("perps.t.noTpslMarket")}
            </p>
          ) : form.tpsl ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Num label={tr("perps.t.tp")} unit="" value={form.takeProfit} onChange={(v) => set({ takeProfit: v })} />
                <Num label={tr("perps.t.sl")} unit="" value={form.stopLoss} onChange={(v) => set({ stopLoss: v })} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-dim">{tr("perps.t.tpslNote")}</span>
                <TriggerBy value={form.workingType} onChange={(w) => set({ workingType: w })} />
              </div>
            </div>
          ) : null}
        </div>
        {effLev && effLev > 10 ? <p className="text-[12px] font-medium text-down">{tr("perps.t.highLev")}</p> : null}
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        {plan ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px] text-sub">
            <dt>{tr("perps.t.size")}</dt>
            <dd className="text-right font-mono tabular-nums">
              {plan.entry.quantity} {base}
            </dd>
            {plan.entry.stopPrice ? (
              <>
                <dt>{tr("perps.t.trigger")}</dt>
                <dd className="text-right font-mono tabular-nums">{plan.entry.stopPrice}</dd>
              </>
            ) : null}
            {plan.entry.price ? (
              <>
                <dt>{tr("perps.t.price")}</dt>
                <dd className="text-right font-mono tabular-nums">{plan.entry.price}</dd>
              </>
            ) : null}
            <dt>{tr("perps.t.value")}</dt>
            <dd className="text-right font-mono tabular-nums">{plan.entry.notional !== undefined ? `${plan.entry.notional.toFixed(2)} USDT` : "—"}</dd>
            <dt>{tr("perps.t.margin", { at: effLev ? tr("perps.t.atLev", { lev: effLev }) : "" })}</dt>
            <dd className="text-right font-mono tabular-nums">{margin !== undefined ? `${margin.toFixed(2)} USDT` : agent ? "—" : tr("perps.t.setLev")}</dd>
            {plan.legs.map((l) => (
              <div key={l.leg} className="contents">
                <dt>{l.leg === "TP" ? tr("perps.t.tp") : tr("perps.t.sl")}</dt>
                <dd className="text-right font-mono tabular-nums">{l.order.stopPrice ?? "—"}</dd>
              </div>
            ))}
            {plan.legs.length ? (
              <dd className="col-span-2 mt-1 text-[11px] text-dim">{tr("perps.t.tpslAfter")}</dd>
            ) : null}
          </dl>
        ) : (
          <p className="text-[12.5px] text-muted">{planError ?? ""}</p>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {!agent ? (
          <Button tone="soft" size="md" className="w-full" onClick={onNeedAgent}>
            {tr("perps.t.setup")}
          </Button>
        ) : hedgeMode ? (
          <p className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px]">
            {rich("perps.t.hedge", { b: (c) => <b>{c}</b> })}
          </p>
        ) : !review ? (
          <button
            type="button"
            disabled={!plan || levBad}
            onClick={() => setReview(true)}
            className={`press h-11 w-full rounded-[10px] text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${form.side === "BUY" ? "bg-up text-[#0B0E11]" : "bg-down text-white"}`}
          >
            {form.side === "BUY" ? tr("perps.t.reviewLong") : tr("perps.t.reviewShort")}
          </button>
        ) : (
          <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
            <p className="text-[13px] font-medium">
              {tr("perps.t.confirm", {
                type: tr(otKey(t)).toLowerCase(),
                dir: form.side === "BUY" ? tr("perps.t.long") : tr("perps.t.short"),
                qty: plan?.entry.quantity ?? "",
                base,
                price: plan?.entry.price ? tr("perps.t.cAt", { p: plan.entry.price }) : "",
                trigger: plan?.entry.stopPrice ? tr("perps.t.cTrigger", { p: plan.entry.stopPrice }) : "",
                lev: plan?.leverage ? tr("perps.t.cLev", { lev: plan.leverage }) : "",
                legs: plan?.legs.length ? tr("perps.t.cLegs", { legs: plan.legs.map((l) => l.leg).join(" + ") }) : "",
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button tone="gold" size="sm" disabled={busy || !plan} onClick={send}>
                {busy ? tr("common.sending") : tr("perps.t.signSend")}
              </Button>
              <Button tone="line" size="sm" disabled={busy} onClick={() => setReview(false)}>
                {tr("common.back")}
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
        {tr("perps.t.footer")}
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
  const { t } = useLocale();
  return (
    <select
      aria-label={t("perps.t.triggerAria")}
      value={value}
      onChange={(e) => onChange(e.target.value as WorkingType)}
      className="rounded-lg border border-line-2 bg-card-2 px-2 text-[12px] text-sub focus:border-gold focus:outline-none"
    >
      <option value="CONTRACT_PRICE">{t("perps.t.last")}</option>
      <option value="MARK_PRICE">{t("perps.t.mark")}</option>
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
  const { t } = useLocale();
  const modeName = (m: MarginType) => (m === "ISOLATED" ? t("perps.t.isolated") : t("perps.t.cross"));
  const shown = Number(value) || currentLev || Math.min(10, maxLev);

  async function switchMode(m: MarginType) {
    if (!agent || !symbol) return;
    setBusy(true);
    setNote(undefined);
    try {
      await signedRequest(agent, "POST", "/fapi/v3/marginType", marginTypeParams(symbol, m));
      setNote(t("perps.t.nowMode", { symbol, mode: modeName(m) }));
    } catch (e) {
      setNote(t("perps.t.keptMode", { e: explainAsterError(e) }));
    } finally {
      setBusy(false);
      setPending(undefined);
      qc.invalidateQueries({ queryKey: ["aster-position-risk"] });
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface p-1" role="group" aria-label={t("perps.t.marginAria")}>
          {(["CROSSED", "ISOLATED"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!agent || !current || busy}
              aria-pressed={current === m}
              onClick={() => current !== m && setPending(m)}
              className={`rounded-md py-1 text-[12.5px] font-semibold disabled:cursor-not-allowed ${current === m ? "bg-card-2 text-fg" : "text-muted hover:text-fg"} ${!agent || !current ? "opacity-50" : ""}`}
            >
              {modeName(m)}
            </button>
          ))}
        </div>
      </div>
      {pending ? (
        <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-[12px]">
          <span>
            {t("perps.t.switchQ", { symbol, mode: modeName(pending) })}
          </span>
          <div className="mt-1.5 flex gap-2">
            <Button tone="gold" size="sm" disabled={busy} onClick={() => switchMode(pending)}>
              {busy ? t("common.sending") : t("perps.t.switchTo", { mode: modeName(pending) })}
            </Button>
            <Button tone="line" size="sm" disabled={busy} onClick={() => setPending(undefined)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {!agent ? <p className="text-[11.5px] text-dim">{t("perps.t.modeNote")}</p> : note ? <p className="text-[11.5px] text-sub">{note}</p> : null}

      <div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-muted">{t("perps.t.leverage")}</span>
          <span className="font-mono tabular-nums">
            {shown}x
            <span className="ml-1 text-[11px] text-dim">{value ? (currentLev && Number(value) === currentLev ? t("perps.t.current") : t("perps.t.was", { v: currentLev ? `${currentLev}x` : "—" })) : currentLev ? t("perps.t.current") : t("perps.t.unchanged")}</span>
            {value ? (
              <button type="button" className="ml-2 text-[11px] text-gold hover:underline" onClick={() => onLev("")}>
                {t("perps.t.reset")}
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
          aria-label={t("perps.t.leverage")}
          className="mt-1 w-full accent-gold"
        />
        <div className="flex justify-between font-mono text-[10.5px] text-dim">
          <span>1x</span>
          <span>
            {maxLev}x {maxKnown ? t("perps.t.maxLev") : t("perps.t.capLev")}
          </span>
        </div>
      </div>
    </div>
  );
}
