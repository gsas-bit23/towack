/**
 * Aster perpetuals: keyless public market data (no API key, no wallet).
 *
 * Endpoints are Aster's Binance-style futures REST API (`/fapi/v3/...`). Both hosts answer with
 * `Access-Control-Allow-Origin: *`, so the browser reads them directly; nothing goes through a Towack server.
 */

export type AsterNet = "mainnet" | "testnet";

export const ASTER_REST: Record<AsterNet, string> = {
  mainnet: "https://fapi.asterdex.com",
  testnet: "https://fapi.asterdex-testnet.com",
};

export const ASTER_APP_URL: Record<AsterNet, string> = {
  mainnet: "https://www.asterdex.com/en/futures/v1",
  testnet: "https://www.asterdex-testnet.com/en/futures/v1",
};

/** Where users create / revoke API wallets ("Pro API" tab). */
export const ASTER_API_WALLET_URL: Record<AsterNet, string> = {
  mainnet: "https://www.asterdex.com/en/api-wallet",
  testnet: "https://www.asterdex-testnet.com/en/api-wallet",
};

export const ASTER_DOCS_URL = "https://github.com/asterdex/api-docs";

export type SymbolRules = {
  symbol: string;
  base: string;
  quote: string;
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  minNotional: string;
  pricePrecision: number;
  quantityPrecision: number;
  orderTypes: string[];
  timeInForce: string[];
};

export type MarketRow = {
  symbol: string;
  base: string;
  /** Decimals of the symbol's tick size, for display rounding. */
  priceDecimals: number;
  lastPrice?: string;
  changePct?: number;
  quoteVolume?: number;
  markPrice?: string;
  indexPrice?: string;
  fundingRate?: number;
  nextFundingTime?: number;
};

type Json = Record<string, unknown>;
const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const n = (v: unknown): number | undefined => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : undefined;
};

/** Live USDT-margined perpetuals from `/fapi/v3/exchangeInfo`, keyed by symbol. */
export function parseExchangeInfo(raw: unknown): Map<string, SymbolRules> {
  const out = new Map<string, SymbolRules>();
  const symbols = (raw as Json | null)?.symbols;
  if (!Array.isArray(symbols)) return out;
  for (const item of symbols as Json[]) {
    if (!item || item.contractType !== "PERPETUAL" || item.status !== "TRADING") continue;
    const filters = Array.isArray(item.filters) ? (item.filters as Json[]) : [];
    const f = (type: string) => filters.find((x) => x?.filterType === type) ?? {};
    const price = f("PRICE_FILTER");
    const lot = f("LOT_SIZE");
    const mlot = f("MARKET_LOT_SIZE");
    const notional = f("MIN_NOTIONAL");
    const symbol = s(item.symbol);
    if (!symbol) continue;
    out.set(symbol, {
      symbol,
      base: s(item.baseAsset),
      quote: s(item.quoteAsset),
      tickSize: s(price.tickSize, "0"),
      stepSize: s(lot.stepSize, "0"),
      minQty: s(lot.minQty, "0"),
      maxQty: s(lot.maxQty, "0"),
      marketStepSize: s(mlot.stepSize, s(lot.stepSize, "0")),
      marketMinQty: s(mlot.minQty, s(lot.minQty, "0")),
      marketMaxQty: s(mlot.maxQty, s(lot.maxQty, "0")),
      minNotional: s(notional.notional, "0"),
      pricePrecision: n(item.pricePrecision) ?? 8,
      quantityPrecision: n(item.quantityPrecision) ?? 8,
      orderTypes: Array.isArray(item.orderTypes) ? (item.orderTypes as unknown[]).map((x) => s(x)) : [],
      timeInForce: Array.isArray(item.timeInForce) ? (item.timeInForce as unknown[]).map((x) => s(x)) : [],
    });
  }
  return out;
}

/** Merge `/fapi/v3/ticker/24hr` and `/fapi/v3/premiumIndex` (both array forms) into rows for live symbols. */
export function mergeMarkets(rules: Map<string, SymbolRules>, tickers: unknown, premium: unknown): MarketRow[] {
  const rows = new Map<string, MarketRow>();
  for (const r of rules.values()) rows.set(r.symbol, { symbol: r.symbol, base: r.base, priceDecimals: tickDecimals(r.tickSize) });
  if (Array.isArray(tickers)) {
    for (const t of tickers as Json[]) {
      const row = rows.get(s(t?.symbol));
      if (!row) continue;
      row.lastPrice = s(t.lastPrice) || undefined;
      row.changePct = n(t.priceChangePercent);
      row.quoteVolume = n(t.quoteVolume);
    }
  }
  if (Array.isArray(premium)) {
    for (const p of premium as Json[]) {
      const row = rows.get(s(p?.symbol));
      if (!row) continue;
      row.markPrice = s(p.markPrice) || undefined;
      row.indexPrice = s(p.indexPrice) || undefined;
      row.fundingRate = n(p.lastFundingRate);
      row.nextFundingTime = n(p.nextFundingTime);
    }
  }
  return [...rows.values()].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
}

export async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const b = typeof body === "object" && body ? (body as Json) : {};
    const msg = "msg" in b ? String(b.msg) : "error" in b ? String(b.error) : `HTTP ${res.status}`;
    const code = "code" in b ? ` (code ${String(b.code)})` : "";
    throw new Error(`${msg}${code}`);
  }
  return body;
}

export async function fetchMarkets(net: AsterNet, signal?: AbortSignal): Promise<{ rules: Map<string, SymbolRules>; rows: MarketRow[] }> {
  const base = ASTER_REST[net];
  const [info, tickers, premium] = await Promise.all([
    getJson(`${base}/fapi/v3/exchangeInfo`, { signal }),
    getJson(`${base}/fapi/v3/ticker/24hr`, { signal }),
    getJson(`${base}/fapi/v3/premiumIndex`, { signal }),
  ]);
  const rules = parseExchangeInfo(info);
  return { rules, rows: mergeMarkets(rules, tickers, premium) };
}

/** Funding rate as a signed percentage string, e.g. 0.0000231 → "+0.0023%". */
export function fmtFunding(rate: number | undefined): string {
  if (rate === undefined) return "—";
  const pct = rate * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(4)}%`;
}

export function fmtCompactUsd(v: number | undefined): string {
  if (v === undefined) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function tickDecimals(tick: string): number {
  const f = tick.split(".")[1];
  return f ? f.replace(/0+$/, "").length : 0;
}

/** Display a price at the market's tick precision (mark / index come with 8 decimals). */
export function fmtPrice(v: string | undefined, decimals: number): string {
  if (!v) return "—";
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(Math.min(decimals, 8)) : "—";
}

/** Trim trailing zeros of a decimal string without going through floats. */
export function trimDecimal(v: string | undefined): string {
  if (!v) return "—";
  if (!v.includes(".")) return v;
  const t = v.replace(/0+$/, "").replace(/\.$/, "");
  return t || "0";
}
