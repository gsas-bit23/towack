/**
 * Aster perp order payloads: validation against `/exchangeInfo` filters and the exact `POST /fapi/v3/order` params.
 * Pure decimal-string math (no floats for size / price).
 */
import type { SymbolRules } from "./markets";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type TimeInForce = "GTC" | "IOC" | "GTX";

export type OrderInput = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  /** Reference price for the notional check (mark price for MARKET orders, per Aster's MIN_NOTIONAL rule). */
  markPrice?: string;
};

export type BuiltOrder = {
  params: [string, string][];
  quantity: string;
  price?: string;
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

/**
 * Build `POST /fapi/v3/order` params, or explain why not. Quantity / price are floored to the symbol's step / tick
 * (never rounded up), and only parameters valid for the order type are sent (Aster rejects extras with PARAM_NOT_REQUIRED).
 */
export function buildOrder(input: OrderInput, rules: SymbolRules | undefined): { ok: true; order: BuiltOrder } | { ok: false; error: string } {
  if (!rules || rules.symbol !== input.symbol) return { ok: false, error: "Pick a market first." };
  if (!DEC.test(input.quantity)) return { ok: false, error: "Enter a size." };
  const market = input.type === "MARKET";
  const step = market ? rules.marketStepSize : rules.stepSize;
  const minQty = market ? rules.marketMinQty : rules.minQty;
  const maxQty = market ? rules.marketMaxQty : rules.maxQty;
  const quantity = floorToStep(input.quantity, step);
  if (cmpDec(quantity, "0") <= 0 || cmpDec(quantity, minQty) < 0) return { ok: false, error: `Minimum size is ${minQty} ${rules.base}.` };
  if (cmpDec(maxQty, "0") > 0 && cmpDec(quantity, maxQty) > 0) return { ok: false, error: `Maximum ${market ? "market " : ""}size is ${maxQty} ${rules.base}.` };

  let price: string | undefined;
  if (!market) {
    if (!input.price || !DEC.test(input.price)) return { ok: false, error: "Enter a limit price." };
    price = floorToStep(input.price, rules.tickSize);
    if (cmpDec(price, "0") <= 0) return { ok: false, error: "Price is below the tick size." };
  }

  const ref = market ? input.markPrice : price;
  const notional = ref && DEC.test(ref) ? Number(quantity) * Number(ref) : undefined;
  const minNotional = Number(rules.minNotional);
  if (notional !== undefined && minNotional > 0 && notional < minNotional) {
    return { ok: false, error: `Order value must be at least ${rules.minNotional} ${rules.quote}.` };
  }

  const params: [string, string][] = [
    ["symbol", rules.symbol],
    ["side", input.side],
    ["type", input.type],
  ];
  if (!market) params.push(["timeInForce", input.timeInForce ?? "GTC"]);
  params.push(["quantity", quantity]);
  if (price) params.push(["price", price]);
  if (input.reduceOnly) params.push(["reduceOnly", "true"]);
  return { ok: true, order: { params, quantity, price, notional } };
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

export type OpenOrder = { orderId: number; symbol: string; side: string; type: string; price: string; origQty: string; executedQty: string; reduceOnly: boolean; time?: number };

export function parseOpenOrders(raw: unknown): OpenOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
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
    }))
    .filter((o) => Number.isFinite(o.orderId) && o.symbol);
}

/** USDT row of `GET /fapi/v3/balance`. */
export function parseUsdtBalance(raw: unknown): { balance: string; available: string } | undefined {
  if (!Array.isArray(raw)) return undefined;
  const row = (raw as Record<string, unknown>[]).find((r) => r?.asset === "USDT");
  if (!row) return undefined;
  return { balance: String(row.balance ?? "0"), available: String(row.availableBalance ?? "0") };
}
