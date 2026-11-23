/**
 * Aster public market data for the perps terminal: candles, order book, recent trades, and the websocket stream
 * names that keep them live. All keyless; the browser talks to Aster directly (REST sends `Access-Control-Allow-Origin: *`).
 * Pure parsers are kept separate from fetchers so they can be unit-tested with Aster's documented payloads.
 */
import { ASTER_REST, getJson, type AsterNet } from "./markets";

/**
 * Market-stream websocket hosts, tried in order. Mainnet: the documented base. Testnet: the docs give
 * `fstream.asterdex-testnet.com` (user-data / examples) and `fstream5.asterdex-testnet.com` (market streams); we try
 * the first and fall back to the second.
 */
export const ASTER_WS: Record<AsterNet, string[]> = {
  mainnet: ["wss://fstream.asterdex.com"],
  testnet: ["wss://fstream.asterdex-testnet.com", "wss://fstream5.asterdex-testnet.com"],
};

/** Intervals offered by the chart (all valid Aster kline intervals). */
export const CHART_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
const finite = (c: Candle) => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite);

/** `GET /fapi/v3/klines` rows `[openTime, o, h, l, c, volume, closeTime, …]` → candles (time in unix seconds, ascending). */
export function parseKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw) {
    if (!Array.isArray(k) || k.length < 6) continue;
    const c = { time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) };
    if (finite(c)) out.push(c);
  }
  out.sort((a, b) => a.time - b.time);
  // lightweight-charts needs strictly increasing times.
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
}

/** `<symbol>@kline_<interval>` event → candle for the given interval, or undefined. */
export function parseKlineEvent(data: unknown, interval: string): Candle | undefined {
  const k = (data as { k?: Record<string, unknown> } | null)?.k;
  if (!k || k.i !== interval) return undefined;
  const c = { time: Math.floor(num(k.t) / 1000), open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), volume: num(k.v) };
  return finite(c) ? c : undefined;
}

export type Level = { price: string; qty: string; p: number; q: number };
export type Book = { bids: Level[]; asks: Level[]; time?: number };

function levels(raw: unknown): Level[] {
  if (!Array.isArray(raw)) return [];
  const out: Level[] = [];
  for (const l of raw) {
    if (!Array.isArray(l) || l.length < 2) continue;
    const price = String(l[0]);
    const qty = String(l[1]);
    const p = Number(price);
    const q = Number(qty);
    if (Number.isFinite(p) && Number.isFinite(q) && q > 0) out.push({ price, qty, p, q });
  }
  return out;
}

/** REST `GET /fapi/v3/depth` ({bids, asks}) or WS `@depth<N>` ({b, a}) → book, bids high→low, asks low→high. */
export function parseDepth(raw: unknown): Book {
  const o = (raw ?? {}) as Record<string, unknown>;
  const bids = levels(o.bids ?? o.b).sort((x, y) => y.p - x.p);
  const asks = levels(o.asks ?? o.a).sort((x, y) => x.p - y.p);
  const t = num(o.T ?? o.E);
  return { bids, asks, time: Number.isFinite(t) ? t : undefined };
}

export type BookRow = Level & { total: number };

/** Top `n` levels with running cumulative size (from the touch outward). */
export function withTotals(side: Level[], n: number): BookRow[] {
  let t = 0;
  return side.slice(0, n).map((l) => {
    t += l.q;
    return { ...l, total: t };
  });
}

export function midSpread(book: Book): { mid: number; spread: number; spreadPct: number } | undefined {
  const b = book.bids[0]?.p;
  const a = book.asks[0]?.p;
  if (b === undefined || a === undefined) return undefined;
  const mid = (a + b) / 2;
  return { mid, spread: a - b, spreadPct: mid > 0 ? ((a - b) / mid) * 100 : 0 };
}

export type Trade = { id: number; price: string; qty: string; time: number; /** Taker side. */ side: "BUY" | "SELL" };

/**
 * Recent trades from REST `GET /fapi/v3/trades` ({id, price, qty, time, isBuyerMaker}) or `@aggTrade` events
 * ({a, p, q, T, m}). Buyer-is-maker means the taker sold. Newest first.
 */
export function parseTrades(raw: unknown): Trade[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: Trade[] = [];
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const agg = "a" in r || "p" in r;
    const id = num(agg ? r.a : r.id);
    const price = String(agg ? r.p : r.price);
    const qty = String(agg ? r.q : r.qty);
    const time = num(agg ? r.T : r.time);
    const maker = agg ? r.m : r.isBuyerMaker;
    if (!Number.isFinite(id) || !Number.isFinite(time) || !Number.isFinite(Number(price)) || !Number.isFinite(Number(qty))) continue;
    out.push({ id, price, qty, time, side: maker === true ? "SELL" : "BUY" });
  }
  return out.sort((a, b) => b.time - a.time || b.id - a.id);
}

/** Merge new trades into a newest-first list, de-duplicated by id, capped. */
export function mergeTrades(prev: Trade[], next: Trade[], cap = 60): Trade[] {
  const seen = new Set<number>();
  const all = [...next, ...prev].sort((a, b) => b.time - a.time || b.id - a.id);
  const out: Trade[] = [];
  for (const t of all) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** `@markPrice` event → mark / index / funding. */
export function parseMarkEvent(data: unknown): { markPrice?: string; indexPrice?: string; fundingRate?: number; nextFundingTime?: number } | undefined {
  const d = data as Record<string, unknown> | null;
  if (!d || d.e !== "markPriceUpdate") return undefined;
  const r = num(d.r);
  const t = num(d.T);
  return {
    markPrice: typeof d.p === "string" ? d.p : undefined,
    indexPrice: typeof d.i === "string" ? d.i : undefined,
    fundingRate: Number.isFinite(r) ? r : undefined,
    nextFundingTime: Number.isFinite(t) ? t : undefined,
  };
}

/** `@ticker` event → last price / 24h change / quote volume. */
export function parseTickerEvent(data: unknown): { lastPrice?: string; changePct?: number; quoteVolume?: number } | undefined {
  const d = data as Record<string, unknown> | null;
  if (!d || d.e !== "24hrTicker") return undefined;
  const pct = num(d.P);
  const qv = num(d.q);
  return { lastPrice: typeof d.c === "string" ? d.c : undefined, changePct: Number.isFinite(pct) ? pct : undefined, quoteVolume: Number.isFinite(qv) ? qv : undefined };
}

export type TerminalStreams = { kline: string; depth: string; trades: string; mark: string; ticker: string };

/** Stream names for one symbol (lowercase, per the docs). */
export function terminalStreams(symbol: string, interval: string): TerminalStreams {
  const s = symbol.toLowerCase();
  return { kline: `${s}@kline_${interval}`, depth: `${s}@depth20@500ms`, trades: `${s}@aggTrade`, mark: `${s}@markPrice@1s`, ticker: `${s}@ticker` };
}

/** Combined-stream URL: `/stream?streams=a/b/c`; messages arrive as `{stream, data}`. */
export function combinedStreamUrl(base: string, streams: string[]): string {
  return `${base}/stream?streams=${streams.join("/")}`;
}

export async function fetchKlines(net: AsterNet, symbol: string, interval: string, limit = 500, signal?: AbortSignal): Promise<Candle[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
  return parseKlines(await getJson(`${ASTER_REST[net]}/fapi/v3/klines?${q}`, { signal }));
}

export async function fetchDepth(net: AsterNet, symbol: string, limit = 20, signal?: AbortSignal): Promise<Book> {
  const q = new URLSearchParams({ symbol, limit: String(limit) });
  return parseDepth(await getJson(`${ASTER_REST[net]}/fapi/v3/depth?${q}`, { signal }));
}

export async function fetchTrades(net: AsterNet, symbol: string, limit = 50, signal?: AbortSignal): Promise<Trade[]> {
  const q = new URLSearchParams({ symbol, limit: String(limit) });
  return parseTrades(await getJson(`${ASTER_REST[net]}/fapi/v3/trades?${q}`, { signal }));
}
