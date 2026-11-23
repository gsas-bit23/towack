import { describe, expect, it } from "vitest";
import { combinedStreamUrl, mergeTrades, midSpread, parseDepth, parseKlineEvent, parseKlines, parseMarkEvent, parseTickerEvent, parseTrades, terminalStreams, withTotals, ASTER_WS } from "./marketData";

describe("klines", () => {
  it("parses Binance-style rows into ascending second-resolution candles, dropping junk / dupes", () => {
    const raw = [
      [1499040060000, "2", "3", "1", "2.5", "10", 1499040119999, "0", 1, "0", "0", "0"],
      [1499040000000, "1", "2", "0.5", "1.5", "5", 1499040059999, "0", 1, "0", "0", "0"],
      [1499040000000, "1", "2", "0.5", "1.5", "5", 1499040059999],
      ["bad"],
      [1499040120000, "x", "2", "1", "1", "1"],
    ];
    expect(parseKlines(raw)).toEqual([
      { time: 1499040000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
      { time: 1499040060, open: 2, high: 3, low: 1, close: 2.5, volume: 10 },
    ]);
    expect(parseKlines({ code: -1 })).toEqual([]);
  });
  it("kline WS event for the active interval only", () => {
    const ev = { e: "kline", k: { t: 123400000, i: "1m", o: "1", c: "2", h: "3", l: "0.5", v: "100" } };
    expect(parseKlineEvent(ev, "1m")).toEqual({ time: 123400, open: 1, high: 3, low: 0.5, close: 2, volume: 100 });
    expect(parseKlineEvent(ev, "5m")).toBeUndefined();
  });
});

describe("book and trades", () => {
  it("parses REST and WS depth, sorts sides, totals and spread", () => {
    const rest = parseDepth({ bids: [["99", "1"], ["100", "2"], ["98", "0"]], asks: [["102", "1"], ["101", "3"]], T: 5 });
    expect(rest.bids.map((l) => l.price)).toEqual(["100", "99"]);
    expect(rest.asks.map((l) => l.price)).toEqual(["101", "102"]);
    expect(withTotals(rest.asks, 5).map((l) => l.total)).toEqual([3, 4]);
    expect(midSpread(rest)).toEqual({ mid: 100.5, spread: 1, spreadPct: (1 / 100.5) * 100 });
    const ws = parseDepth({ e: "depthUpdate", E: 9, b: [["1", "1"]], a: [["2", "1"]] });
    expect(ws.bids[0].p).toBe(1);
    expect(midSpread({ bids: [], asks: [] })).toBeUndefined();
  });
  it("trades: buyer-maker = taker sell; REST and aggTrade shapes; merge de-dupes newest first", () => {
    const rest = parseTrades([{ id: 1, price: "10", qty: "1", time: 100, isBuyerMaker: true }, { id: 2, price: "11", qty: "1", time: 200, isBuyerMaker: false }]);
    expect(rest.map((t) => [t.id, t.side])).toEqual([[2, "BUY"], [1, "SELL"]]);
    const agg = parseTrades({ e: "aggTrade", a: 3, p: "12", q: "0.5", T: 300, m: false });
    expect(agg).toEqual([{ id: 3, price: "12", qty: "0.5", time: 300, side: "BUY" }]);
    expect(mergeTrades(rest, [...agg, rest[0]]).map((t) => t.id)).toEqual([3, 2, 1]);
    expect(mergeTrades(rest, agg, 2)).toHaveLength(2);
  });
});

describe("streams", () => {
  it("names are lowercase and the combined URL follows the docs", () => {
    const s = terminalStreams("BTCUSDT", "15m");
    expect(s).toEqual({ kline: "btcusdt@kline_15m", depth: "btcusdt@depth20@500ms", trades: "btcusdt@aggTrade", mark: "btcusdt@markPrice@1s", ticker: "btcusdt@ticker" });
    expect(combinedStreamUrl(ASTER_WS.mainnet[0], [s.kline, s.depth])).toBe("wss://fstream.asterdex.com/stream?streams=btcusdt@kline_15m/btcusdt@depth20@500ms");
    expect(ASTER_WS.testnet).toEqual(["wss://fstream.asterdex-testnet.com", "wss://fstream5.asterdex-testnet.com"]);
  });
  it("mark and ticker events", () => {
    expect(parseMarkEvent({ e: "markPriceUpdate", p: "100", i: "99", r: "0.0001", T: 5 })).toEqual({ markPrice: "100", indexPrice: "99", fundingRate: 0.0001, nextFundingTime: 5 });
    expect(parseMarkEvent({ e: "other" })).toBeUndefined();
    expect(parseTickerEvent({ e: "24hrTicker", c: "101", P: "-1.5", q: "1000" })).toEqual({ lastPrice: "101", changePct: -1.5, quoteVolume: 1000 });
  });
});
