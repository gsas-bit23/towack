/**
 * Aster perp order payloads: validation against `/exchangeInfo` filters and the exact `POST /fapi/v3/order` params.
 * Pure decimal-string math (no floats for size / price).
 */
import type { SymbolRules } from "./markets";

export type OrderSide = "BUY" | "SELL";
/** Every order type Aster lists in `exchangeInfo.orderTypes`. The UI only offers the ones the symbol actually lists. */
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET" | "TRAILING_STOP_MARKET";
export type TimeInForce = "GTC" | "IOC" | "GTX";
/** What a conditional order's `stopPrice` is compared with. Aster's default is CONTRACT_PRICE (last trade). */
export type WorkingType = "CONTRACT_PRICE" | "MARK_PRICE";
export type MarginType = "ISOLATED" | "CROSSED";

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  LIMIT: "Limit",
  MARKET: "Market",
  STOP: "Stop limit",
  STOP_MARKET: "Stop market",
  TAKE_PROFIT: "Take-profit limit",
  TAKE_PROFIT_MARKET: "Take-profit market",
  TRAILING_STOP_MARKET: "Trailing stop",
};

/** Types that carry a limit `price` (and so a timeInForce). */
export const hasLimitPrice = (t: OrderType) => t === "LIMIT" || t === "STOP" || t === "TAKE_PROFIT";
/** Types that carry a `stopPrice` trigger. */
export const hasStopPrice = (t: OrderType) => t === "STOP" || t === "STOP_MARKET" || t === "TAKE_PROFIT" || t === "TAKE_PROFIT_MARKET";
/** Types that execute as market orders (use MARKET_LOT_SIZE). */
export const isMarketExec = (t: OrderType) => t === "MARKET" || t === "STOP_MARKET" || t === "TAKE_PROFIT_MARKET" || t === "TRAILING_STOP_MARKET";
export const isConditional = (t: OrderType) => hasStopPrice(t) || t === "TRAILING_STOP_MARKET";

export type OrderInput = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  /** Trigger for STOP / STOP_MARKET / TAKE_PROFIT / TAKE_PROFIT_MARKET. */
  stopPrice?: string;
  /** TRAILING_STOP_MARKET: callback rate in percent, 0.1–5 (1 = 1%). */
  callbackRate?: string;
  /** TRAILING_STOP_MARKET: optional activation price (default: Aster uses the latest price). */
  activationPrice?: string;
  workingType?: WorkingType;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  /** Reference price for the notional check (mark price for MARKET orders, per Aster's MIN_NOTIONAL rule). */
  markPrice?: string;
  /** Last trade price; with markPrice, used to reject triggers that would fire immediately (Aster code -2021). */
  lastPrice?: string;
};

export type BuiltOrder = {
  params: [string, string][];
  quantity: string;
  price?: string;
  stopPrice?: string;
  notional?: number;
};

const DEC = /^\d+(\.\d+)?$/;

function decimals(v: string): number {
  const i = v.indexOf(".");
  return i < 0 ? 0 : v.length - i - 1;
}

function toScaled(v: string, d: number): bigint {
  const [i, f = ""] = v.split(".");
  return BigInt(i + f.padEnd(d, "0").slice(0, d));
}

function fromScaled(x: bigint, d: number): string {
  if (d === 0) return x.toString();
  const s = x.toString().padStart(d + 1, "0");
  const out = `${s.slice(0, -d)}.${s.slice(-d)}`.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}

/** Floor a positive decimal string to a multiple of `step` (e.g. "0.0019", "0.001" → "0.001"). */
export function floorToStep(value: string, step: string): string {
  if (!DEC.test(value) || !DEC.test(step)) return value;
  const d = Math.max(decimals(value), decimals(step));
  const st = toScaled(step, d);
  if (st === 0n) return value;
  const v = toScaled(value, d);
  return fromScaled((v / st) * st, d);
}

export function cmpDec(a: string, b: string): number {
  const d = Math.max(decimals(a), decimals(b));
  const x = toScaled(a, d);
  const y = toScaled(b, d);
  return x === y ? 0 : x > y ? 1 : -1;
}

/** Normalise user typing: digits and one dot, no leading junk. */
export function cleanDecimalInput(v: string): string {
  const s = v.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
}

/** A finite positive number as a plain decimal string (no exponent), at most `d` decimals, truncated. */
export function numToDec(x: number, d: number): string {
  if (!Number.isFinite(x) || x <= 0) return "0";
  const f = Math.max(0, Math.min(d, 18));
  const m = 10 ** f;
  const t = Math.floor(x * m + 1e-9) / m;
  return t.toFixed(f).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Would a conditional order fire the moment it lands? Aster's trigger rules (v3 docs, New Order):
 * STOP / STOP_MARKET fire for BUY when price >= stopPrice, for SELL when price <= stopPrice;
 * TAKE_PROFIT / TAKE_PROFIT_MARKET fire for BUY when price <= stopPrice, for SELL when price >= stopPrice.
 * Returns an error string, or undefined if the trigger is on the correct side of `ref` (or ref is unknown).
 */
export function triggerError(type: OrderType, side: OrderSide, stopPrice: string, ref: string | undefined): string | undefined {
  if (!ref || !DEC.test(ref) || !hasStopPrice(type)) return undefined;
  const c = cmpDec(stopPrice, ref);
  const stop = type === "STOP" || type === "STOP_MARKET";
  // stop BUY needs stop > ref; stop SELL needs stop < ref; TP BUY needs stop < ref; TP SELL needs stop > ref.
  const needAbove = stop ? side === "BUY" : side === "SELL";
  if (needAbove && c <= 0) return `Trigger must be above the current price (${trimRef(ref)}) or it fires immediately.`;
  if (!needAbove && c >= 0) return `Trigger must be below the current price (${trimRef(ref)}) or it fires immediately.`;
  return undefined;
}

const trimRef = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

/**
 * Build `POST /fapi/v3/order` params, or explain why not. Quantity / prices are floored to the symbol's step / tick
 * (never rounded up), and only parameters valid for the order type are sent (Aster rejects extras with PARAM_NOT_REQUIRED).
 * One-way mode only: no positionSide is sent (Aster defaults to BOTH).
 */
export function buildOrder(input: OrderInput, rules: SymbolRules | undefined): { ok: true; order: BuiltOrder } | { ok: false; error: string } {
  if (!rules || rules.symbol !== input.symbol) return { ok: false, error: "Pick a market first." };
  const t = input.type;
  if (rules.orderTypes.length && !rules.orderTypes.includes(t)) return { ok: false, error: `${ORDER_TYPE_LABEL[t] ?? t} orders aren't offered on ${rules.symbol}.` };
  if (!DEC.test(input.quantity)) return { ok: false, error: "Enter a size." };
  const market = isMarketExec(t);
  const step = market ? rules.marketStepSize : rules.stepSize;
  const minQty = market ? rules.marketMinQty : rules.minQty;
  const maxQty = market ? rules.marketMaxQty : rules.maxQty;
  const quantity = floorToStep(input.quantity, step);
  if (cmpDec(quantity, "0") <= 0 || cmpDec(quantity, minQty) < 0) return { ok: false, error: `Minimum size is ${minQty} ${rules.base}.` };
  if (cmpDec(maxQty, "0") > 0 && cmpDec(quantity, maxQty) > 0) return { ok: false, error: `Maximum ${market ? "market " : ""}size is ${maxQty} ${rules.base}.` };

  let price: string | undefined;
  if (hasLimitPrice(t)) {
    if (!input.price || !DEC.test(input.price)) return { ok: false, error: "Enter a limit price." };
    price = floorToStep(input.price, rules.tickSize);
    if (cmpDec(price, "0") <= 0) return { ok: false, error: "Price is below the tick size." };
  }

  let stopPrice: string | undefined;
  const workingType: WorkingType = input.workingType ?? "CONTRACT_PRICE";
  if (hasStopPrice(t)) {
    if (!input.stopPrice || !DEC.test(input.stopPrice)) return { ok: false, error: "Enter a trigger price." };
    stopPrice = floorToStep(input.stopPrice, rules.tickSize);
    if (cmpDec(stopPrice, "0") <= 0) return { ok: false, error: "Trigger is below the tick size." };
    const ref = workingType === "MARK_PRICE" ? input.markPrice : (input.lastPrice ?? input.markPrice);
    const te = triggerError(t, input.side, stopPrice, ref);
    if (te) return { ok: false, error: te };
  }

  let callbackRate: string | undefined;
  let activationPrice: string | undefined;
  if (t === "TRAILING_STOP_MARKET") {
    if (!input.callbackRate || !DEC.test(input.callbackRate)) return { ok: false, error: "Enter a callback rate (0.1–5%)." };
    callbackRate = floorToStep(input.callbackRate, "0.1");
    if (cmpDec(callbackRate, "0.1") < 0 || cmpDec(callbackRate, "5") > 0) return { ok: false, error: "Callback rate must be between 0.1% and 5%." };
    if (input.activationPrice) {
      if (!DEC.test(input.activationPrice)) return { ok: false, error: "Activation price isn't a number." };
      activationPrice = floorToStep(input.activationPrice, rules.tickSize);
      const ref = workingType === "MARK_PRICE" ? input.markPrice : (input.lastPrice ?? input.markPrice);
      // Docs: BUY activationPrice must be below the latest price, SELL above (else -2021).
      if (ref && DEC.test(ref)) {
        const c = cmpDec(activationPrice, ref);
        if (input.side === "BUY" && c >= 0) return { ok: false, error: `For a buy trailing stop, activation must be below the current price (${trimRef(ref)}).` };
        if (input.side === "SELL" && c <= 0) return { ok: false, error: `For a sell trailing stop, activation must be above the current price (${trimRef(ref)}).` };
      }
    }
  }

  const ref = price ?? stopPrice ?? activationPrice ?? input.markPrice;
  const notional = ref && DEC.test(ref) ? Number(quantity) * Number(ref) : undefined;
  const minNotional = Number(rules.minNotional);
  if (notional !== undefined && minNotional > 0 && notional < minNotional) {
    return { ok: false, error: `Order value must be at least ${rules.minNotional} ${rules.quote}.` };
  }

  const params: [string, string][] = [
    ["symbol", rules.symbol],
    ["side", input.side],
    ["type", t],
  ];
  if (hasLimitPrice(t)) params.push(["timeInForce", input.timeInForce ?? "GTC"]);
  params.push(["quantity", quantity]);
  if (price) params.push(["price", price]);
  if (stopPrice) params.push(["stopPrice", stopPrice]);
  if (activationPrice) params.push(["activationPrice", activationPrice]);
  if (callbackRate) params.push(["callbackRate", callbackRate]);
  if (isConditional(t) && input.workingType) params.push(["workingType", input.workingType]);
  if (input.reduceOnly) params.push(["reduceOnly", "true"]);
  return { ok: true, order: { params, quantity, price, stopPrice, notional } };
}

export type BracketInput = {
  /** The entry being protected. */
  side: OrderSide;
  quantity: string;
  /** Price the entry is expected to fill at (limit price, stop trigger, or mark for market). */
  entryPrice: string | undefined;
  takeProfit?: string;
  stopLoss?: string;
  workingType?: WorkingType;
  markPrice?: string;
  lastPrice?: string;
};

/**
 * Attached TP / SL for an entry: reduce-only TAKE_PROFIT_MARKET / STOP_MARKET on the opposite side, same size.
 * They are placed as separate orders after the entry (sequential `POST /fapi/v3/order`), and stay as reduce-only
 * conditionals if a limit entry fills later.
 */
export function buildBracket(b: BracketInput, rules: SymbolRules | undefined): { ok: true; orders: { leg: "TP" | "SL"; order: BuiltOrder }[] } | { ok: false; error: string } {
  if (!rules) return { ok: false, error: "Pick a market first." };
  const close: OrderSide = b.side === "BUY" ? "SELL" : "BUY";
  const long = b.side === "BUY";
  const out: { leg: "TP" | "SL"; order: BuiltOrder }[] = [];
  const legs: ["TP" | "SL", string | undefined, OrderType][] = [
    ["TP", b.takeProfit, "TAKE_PROFIT_MARKET"],
    ["SL", b.stopLoss, "STOP_MARKET"],
  ];
  for (const [leg, px, type] of legs) {
    if (!px) continue;
    if (!DEC.test(px)) return { ok: false, error: `${leg} price isn't a number.` };
    const p = floorToStep(px, rules.tickSize);
    if (b.entryPrice && DEC.test(b.entryPrice)) {
      const c = cmpDec(p, b.entryPrice);
      const wantAbove = leg === "TP" ? long : !long;
      if (wantAbove && c <= 0) return { ok: false, error: `${leg} must be above the entry (${trimRef(b.entryPrice)}) for a ${long ? "long" : "short"}.` };
      if (!wantAbove && c >= 0) return { ok: false, error: `${leg} must be below the entry (${trimRef(b.entryPrice)}) for a ${long ? "long" : "short"}.` };
    }
    const r = buildOrder(
      { symbol: rules.symbol, side: close, type, quantity: b.quantity, stopPrice: p, workingType: b.workingType, reduceOnly: true, markPrice: b.markPrice, lastPrice: b.lastPrice },
      rules,
    );
    if (!r.ok) return { ok: false, error: `${leg}: ${r.error}` };
    out.push({ leg, order: r.order });
  }
  return { ok: true, orders: out };
}

export function marginTypeParams(symbol: string, marginType: MarginType): [string, string][] {
  return [
    ["symbol", symbol],
    ["marginType", marginType],
  ];
}

/**
 * Size from a share of available margin: qty = available × pct × leverage / price, floored to the step.
 * Before fees, so 100% can be rejected by Aster for insufficient margin once fees are counted.
 */
export function sizeFromPercent(
  a: { available: string | undefined; pct: number; leverage: number; price: string | undefined; type: OrderType },
  rules: SymbolRules | undefined,
): { ok: true; quantity: string } | { ok: false; error: string } {
  if (!rules) return { ok: false, error: "Pick a market first." };
  const avail = Number(a.available);
  const px = Number(a.price);
  if (!Number.isFinite(avail) || avail <= 0) return { ok: false, error: "No available USDT margin." };
  if (!Number.isFinite(px) || px <= 0) return { ok: false, error: "Need a price to size from." };
  if (!(a.pct > 0 && a.pct <= 100) || !(a.leverage >= 1)) return { ok: false, error: "Bad size inputs." };
  const market = isMarketExec(a.type);
  const step = market ? rules.marketStepSize : rules.stepSize;
  const minQty = market ? rules.marketMinQty : rules.minQty;
  const raw = (avail * (a.pct / 100) * a.leverage) / px;
  const quantity = floorToStep(numToDec(raw, decimals(step) + 2), step);
  if (cmpDec(quantity, "0") <= 0 || cmpDec(quantity, minQty) < 0) return { ok: false, error: `Too small: under the ${minQty} ${rules.base} minimum.` };
  const minNotional = Number(rules.minNotional);
  if (minNotional > 0 && Number(quantity) * px < minNotional) return { ok: false, error: `Too small: under the ${rules.minNotional} ${rules.quote} minimum value.` };
  return { ok: true, quantity };
}

export function cancelParams(symbol: string, orderId: string | number): [string, string][] {
  return [
    ["symbol", symbol],
    ["orderId", String(orderId)],
  ];
}

export function leverageParams(symbol: string, leverage: number): [string, string][] | undefined {
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) return undefined;
  return [
    ["symbol", symbol],
    ["leverage", String(leverage)],
  ];
}

export type OpenOrder = {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  reduceOnly: boolean;
  time?: number;
  /** Trigger of a conditional order ("0" when none). */
  stopPrice?: string;
};

type Obj = Record<string, unknown>;
const isObj = (o: unknown): o is Obj => Boolean(o) && typeof o === "object";
const str = (v: unknown, d = "0") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const ms = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function parseOpenOrders(raw: unknown): OpenOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((o) => ({
      orderId: Number(o.orderId),
      symbol: String(o.symbol ?? ""),
      side: String(o.side ?? ""),
      type: String(o.type ?? ""),
      price: String(o.price ?? "0"),
      origQty: String(o.origQty ?? "0"),
      executedQty: String(o.executedQty ?? "0"),
      reduceOnly: o.reduceOnly === true,
      time: typeof o.time === "number" ? o.time : undefined,
      ...(o.stopPrice !== undefined ? { stopPrice: str(o.stopPrice) } : {}),
    }))
    .filter((o) => Number.isFinite(o.orderId) && o.symbol);
}

export type OrderHistoryRow = OpenOrder & { status: string; avgPrice: string; updateTime?: number };

/** `GET /fapi/v3/allOrders`, newest first. */
export function parseOrderHistory(raw: unknown): OrderHistoryRow[] {
  if (!Array.isArray(raw)) return [];
  const base = parseOpenOrders(raw);
  const byId = new Map(raw.filter(isObj).map((o) => [Number(o.orderId), o]));
  return base
    .map((o) => {
      const r = byId.get(o.orderId) ?? {};
      return { ...o, status: str(r.status, ""), avgPrice: str(r.avgPrice), updateTime: ms(r.updateTime) };
    })
    .sort((a, b) => (b.updateTime ?? b.time ?? 0) - (a.updateTime ?? a.time ?? 0));
}

export type Position = {
  symbol: string;
  /** Signed size: > 0 long, < 0 short. */
  positionAmt: string;
  side: "LONG" | "SHORT";
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unRealizedProfit: string;
  leverage: number;
  marginType: MarginType;
  /** Isolated margin, or notional / leverage for cross (Aster's positionRisk has no cross-margin field). */
  margin: string;
  notional: string;
  positionSide: string;
};

const marginOf = (v: unknown): MarginType => (String(v ?? "").toLowerCase().startsWith("iso") ? "ISOLATED" : "CROSSED");

/** All `GET /fapi/v3/positionRisk` rows (flat ones too: they carry the symbol's leverage and margin type). */
export function parsePositionRows(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).flatMap((p) => {
    const symbol = str(p.symbol, "");
    if (!symbol) return [];
    const amt = str(p.positionAmt);
    const leverage = Number(p.leverage);
    const marginType = marginOf(p.marginType);
    const notional = str(p.notional);
    const lev = Number.isFinite(leverage) && leverage > 0 ? leverage : 1;
    const margin = marginType === "ISOLATED" ? str(p.isolatedMargin) : String(Math.abs(Number(notional)) / lev);
    return [
      {
        symbol,
        positionAmt: amt,
        side: Number(amt) < 0 ? ("SHORT" as const) : ("LONG" as const),
        entryPrice: str(p.entryPrice),
        markPrice: str(p.markPrice),
        liquidationPrice: str(p.liquidationPrice),
        unRealizedProfit: str(p.unRealizedProfit),
        leverage: lev,
        marginType,
        margin,
        notional,
        positionSide: str(p.positionSide, "BOTH"),
      },
    ];
  });
}

/** Open positions only. */
export function parsePositions(raw: unknown): Position[] {
  return parsePositionRows(raw).filter((p) => Number(p.positionAmt) !== 0);
}

export type UserTrade = { id: number; orderId: number; symbol: string; side: string; price: string; qty: string; quoteQty: string; realizedPnl: string; commission: string; commissionAsset: string; maker: boolean; time: number };

/** `GET /fapi/v3/userTrades`, newest first. */
export function parseUserTrades(raw: unknown): UserTrade[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((t) => ({
      id: Number(t.id),
      orderId: Number(t.orderId),
      symbol: str(t.symbol, ""),
      side: str(t.side, ""),
      price: str(t.price),
      qty: str(t.qty),
      quoteQty: str(t.quoteQty),
      realizedPnl: str(t.realizedPnl),
      commission: str(t.commission),
      commissionAsset: str(t.commissionAsset, ""),
      maker: t.maker === true,
      time: ms(t.time) ?? 0,
    }))
    .filter((t) => Number.isFinite(t.id) && t.symbol)
    .sort((a, b) => b.time - a.time);
}

/** `GET /fapi/v3/positionSide/dual` → true when the account is in Hedge mode. */
export function parseDualSide(raw: unknown): boolean | undefined {
  if (!isObj(raw)) return undefined;
  const v = raw.dualSidePosition;
  return v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;
}

/** Max initial leverage of the first notional bracket from `GET /fapi/v3/leverageBrackets?symbol=`. */
export function parseMaxLeverage(raw: unknown, symbol: string): number | undefined {
  const row = Array.isArray(raw) ? raw.filter(isObj).find((r) => r.symbol === symbol) : isObj(raw) ? raw : undefined;
  const brackets = row && Array.isArray(row.brackets) ? (row.brackets as unknown[]).filter(isObj) : [];
  const lev = brackets.map((b) => Number(b.initialLeverage)).filter((n) => Number.isInteger(n) && n >= 1);
  return lev.length ? Math.min(125, Math.max(...lev)) : undefined;
}

/** Initial margin for a notional at a leverage. */
export function estMargin(notional: number | undefined, leverage: number | undefined): number | undefined {
  return notional !== undefined && leverage && leverage >= 1 ? notional / leverage : undefined;
}

/** USDT row of `GET /fapi/v3/balance`. */
export function parseUsdtBalance(raw: unknown): { balance: string; available: string } | undefined {
  if (!Array.isArray(raw)) return undefined;
  const row = (raw as Record<string, unknown>[]).find((r) => r?.asset === "USDT");
  if (!row) return undefined;
  return { balance: String(row.balance ?? "0"), available: String(row.availableBalance ?? "0") };
}
