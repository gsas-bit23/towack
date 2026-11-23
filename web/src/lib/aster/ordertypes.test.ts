import { describe, expect, it } from "vitest";
import info from "./__fixtures__/exchangeInfo.json";
import { parseExchangeInfo } from "./markets";
import {
  buildBracket,
  buildOrder,
  estMargin,
  marginTypeParams,
  numToDec,
  parseDualSide,
  parseMaxLeverage,
  parseOrderHistory,
  parsePositionRows,
  parsePositions,
  parseUserTrades,
  sizeFromPercent,
  triggerError,
} from "./orders";

const btc = parseExchangeInfo(info).get("BTCUSDT")!;
const base = { symbol: "BTCUSDT", quantity: "0.002", markPrice: "60000", lastPrice: "60010" } as const;

describe("conditional order types", () => {
  it("STOP (stop-limit): timeInForce + quantity + price + stopPrice, floored to tick", () => {
    const r = buildOrder({ ...base, side: "BUY", type: "STOP", price: "61000.07", stopPrice: "60900.09", timeInForce: "GTC" }, btc);
    expect(r.ok && r.order.params).toEqual([
      ["symbol", "BTCUSDT"],
      ["side", "BUY"],
      ["type", "STOP"],
      ["timeInForce", "GTC"],
      ["quantity", "0.002"],
      ["price", "61000"],
      ["stopPrice", "60900"],
    ]);
    expect(r.ok && r.order.notional).toBeCloseTo(122);
  });
  it("STOP_MARKET: stopPrice + quantity only (no price / timeInForce), workingType when chosen", () => {
    const r = buildOrder({ ...base, side: "SELL", type: "STOP_MARKET", price: "1", stopPrice: "59000", workingType: "MARK_PRICE", timeInForce: "GTC" }, btc);
    expect(r.ok && r.order.params).toEqual([
      ["symbol", "BTCUSDT"],
      ["side", "SELL"],
      ["type", "STOP_MARKET"],
      ["quantity", "0.002"],
      ["stopPrice", "59000"],
      ["workingType", "MARK_PRICE"],
    ]);
  });
  it("rejects triggers that would fire immediately (docs trigger rules)", () => {
    // STOP BUY fires when price >= stop: stop must be above the market.
    expect(buildOrder({ ...base, side: "BUY", type: "STOP_MARKET", stopPrice: "59000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("above") });
    // STOP SELL fires when price <= stop: stop must be below.
    expect(buildOrder({ ...base, side: "SELL", type: "STOP_MARKET", stopPrice: "61000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("below") });
    // TAKE_PROFIT BUY fires when price <= stop: below. SELL: above.
    expect(triggerError("TAKE_PROFIT_MARKET", "BUY", "61000", "60000")).toContain("below");
    expect(triggerError("TAKE_PROFIT_MARKET", "SELL", "59000", "60000")).toContain("above");
    expect(triggerError("TAKE_PROFIT_MARKET", "SELL", "61000", "60000")).toBeUndefined();
    expect(triggerError("STOP", "BUY", "61000", undefined)).toBeUndefined();
    // workingType picks the reference: last 60010 vs mark 60000.
    expect(buildOrder({ ...base, side: "BUY", type: "STOP_MARKET", stopPrice: "60005" }, btc).ok).toBe(false);
    expect(buildOrder({ ...base, side: "BUY", type: "STOP_MARKET", stopPrice: "60005", workingType: "MARK_PRICE" }, btc).ok).toBe(true);
  });
  it("needs a trigger, and refuses types the symbol doesn't list", () => {
    expect(buildOrder({ ...base, side: "BUY", type: "STOP_MARKET" }, btc)).toMatchObject({ ok: false, error: "Enter a trigger price." });
    const limited = { ...btc, orderTypes: ["LIMIT", "MARKET"] };
    expect(buildOrder({ ...base, side: "BUY", type: "STOP_MARKET", stopPrice: "61000" }, limited)).toMatchObject({ ok: false, error: expect.stringContaining("aren't offered") });
  });
  it("TRAILING_STOP_MARKET: callbackRate 0.1–5 and activation direction", () => {
    const r = buildOrder({ ...base, side: "SELL", type: "TRAILING_STOP_MARKET", callbackRate: "1.25", activationPrice: "61000" }, btc);
    expect(r.ok && r.order.params).toEqual([
      ["symbol", "BTCUSDT"],
      ["side", "SELL"],
      ["type", "TRAILING_STOP_MARKET"],
      ["quantity", "0.002"],
      ["activationPrice", "61000"],
      ["callbackRate", "1.2"],
    ]);
    expect(buildOrder({ ...base, side: "SELL", type: "TRAILING_STOP_MARKET", callbackRate: "6" }, btc)).toMatchObject({ ok: false });
    expect(buildOrder({ ...base, side: "SELL", type: "TRAILING_STOP_MARKET", callbackRate: "0.05" }, btc)).toMatchObject({ ok: false });
    expect(buildOrder({ ...base, side: "SELL", type: "TRAILING_STOP_MARKET", callbackRate: "1", activationPrice: "59000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("above") });
    expect(buildOrder({ ...base, side: "BUY", type: "TRAILING_STOP_MARKET", callbackRate: "1", activationPrice: "61000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("below") });
    expect(buildOrder({ ...base, side: "BUY", type: "TRAILING_STOP_MARKET", callbackRate: "1" }, btc).ok).toBe(true);
  });
});

describe("attached TP / SL", () => {
  it("long entry: reduce-only SELL TAKE_PROFIT_MARKET above and STOP_MARKET below", () => {
    const r = buildBracket({ side: "BUY", quantity: "0.002", entryPrice: "60000", takeProfit: "63000.05", stopLoss: "58000", markPrice: "60000", lastPrice: "60000" }, btc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orders.map((o) => [o.leg, o.order.params])).toEqual([
      ["TP", [["symbol", "BTCUSDT"], ["side", "SELL"], ["type", "TAKE_PROFIT_MARKET"], ["quantity", "0.002"], ["stopPrice", "63000"], ["reduceOnly", "true"]]],
      ["SL", [["symbol", "BTCUSDT"], ["side", "SELL"], ["type", "STOP_MARKET"], ["quantity", "0.002"], ["stopPrice", "58000"], ["reduceOnly", "true"]]],
    ]);
  });
  it("short entry flips sides and directions; workingType carried", () => {
    const r = buildBracket({ side: "SELL", quantity: "0.002", entryPrice: "60000", takeProfit: "57000", stopLoss: "62000", workingType: "MARK_PRICE", markPrice: "60000" }, btc);
    expect(r.ok && r.orders.map((o) => o.order.params.find(([k]) => k === "side")?.[1])).toEqual(["BUY", "BUY"]);
    expect(r.ok && r.orders[0].order.params).toContainEqual(["workingType", "MARK_PRICE"]);
  });
  it("rejects TP / SL on the wrong side of the entry or the market", () => {
    expect(buildBracket({ side: "BUY", quantity: "0.002", entryPrice: "60000", takeProfit: "59000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("TP must be above") });
    expect(buildBracket({ side: "BUY", quantity: "0.002", entryPrice: "60000", stopLoss: "61000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("SL must be below") });
    // limit long at 59000 with the market at 60000: a TP at 59500 is above the entry but would fire at once.
    expect(buildBracket({ side: "BUY", quantity: "0.002", entryPrice: "59000", takeProfit: "59500", lastPrice: "60000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("TP:") });
    expect(buildBracket({ side: "BUY", quantity: "0.002", entryPrice: "60000" }, btc)).toEqual({ ok: true, orders: [] });
  });
});

describe("margin, leverage and sizing", () => {
  it("marginType params", () => {
    expect(marginTypeParams("BTCUSDT", "ISOLATED")).toEqual([["symbol", "BTCUSDT"], ["marginType", "ISOLATED"]]);
    expect(marginTypeParams("BTCUSDT", "CROSSED")).toEqual([["symbol", "BTCUSDT"], ["marginType", "CROSSED"]]);
  });
  it("% of available balance → floored quantity", () => {
    // 100 USDT × 50% × 10x / 60000 = 0.008333 → 0.008
    expect(sizeFromPercent({ available: "100", pct: 50, leverage: 10, price: "60000", type: "LIMIT" }, btc)).toEqual({ ok: true, quantity: "0.008" });
    expect(sizeFromPercent({ available: "100", pct: 100, leverage: 1, price: "60000", type: "MARKET" }, btc)).toEqual({ ok: true, quantity: "0.001" });
    expect(sizeFromPercent({ available: "10", pct: 25, leverage: 1, price: "60000", type: "LIMIT" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("minimum") });
    expect(sizeFromPercent({ available: "0", pct: 25, leverage: 5, price: "60000", type: "LIMIT" }, btc)).toMatchObject({ ok: false });
    expect(sizeFromPercent({ available: "100", pct: 25, leverage: 5, price: undefined, type: "LIMIT" }, btc)).toMatchObject({ ok: false });
  });
  it("estimated margin and decimal formatting", () => {
    expect(estMargin(600, 10)).toBe(60);
    expect(estMargin(600, undefined)).toBeUndefined();
    expect(numToDec(0.0083333, 5)).toBe("0.00833");
    expect(numToDec(1e-7, 8)).toBe("0.0000001");
    expect(numToDec(12, 3)).toBe("12");
  });
});

describe("account parsers", () => {
  const risk = [
    { symbol: "BTCUSDT", positionAmt: "-0.010", entryPrice: "60000", markPrice: "59000", liquidationPrice: "65000", unRealizedProfit: "10", leverage: "20", marginType: "isolated", isolatedMargin: "30.5", notional: "-590", positionSide: "BOTH" },
    { symbol: "ETHUSDT", positionAmt: "0.000", entryPrice: "0", markPrice: "3000", liquidationPrice: "0", unRealizedProfit: "0", leverage: "5", marginType: "cross", isolatedMargin: "0", notional: "0", positionSide: "BOTH" },
  ];
  it("positionRisk: all rows keep leverage / margin type, open positions filter flat ones", () => {
    const rows = parsePositionRows(risk);
    expect(rows.map((r) => [r.symbol, r.leverage, r.marginType])).toEqual([
      ["BTCUSDT", 20, "ISOLATED"],
      ["ETHUSDT", 5, "CROSSED"],
    ]);
    const open = parsePositions(risk);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ side: "SHORT", margin: "30.5", liquidationPrice: "65000" });
    expect(parsePositions({ code: -1 })).toEqual([]);
  });
  it("allOrders / userTrades newest first; dual side; leverage brackets", () => {
    const h = parseOrderHistory([
      { orderId: 1, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "1", origQty: "1", executedQty: "1", status: "FILLED", avgPrice: "1", time: 1, updateTime: 5 },
      { orderId: 2, symbol: "BTCUSDT", side: "SELL", type: "STOP_MARKET", price: "0", stopPrice: "9", origQty: "1", executedQty: "0", status: "NEW", avgPrice: "0", time: 9, updateTime: 9 },
    ]);
    expect(h.map((o) => [o.orderId, o.status, o.stopPrice])).toEqual([
      [2, "NEW", "9"],
      [1, "FILLED", undefined],
    ]);
    const t = parseUserTrades([
      { id: 1, orderId: 1, symbol: "BTCUSDT", side: "BUY", price: "1", qty: "1", quoteQty: "1", realizedPnl: "0", commission: "0.01", commissionAsset: "USDT", maker: true, time: 1 },
      { id: 2, orderId: 1, symbol: "BTCUSDT", side: "BUY", price: "1", qty: "1", quoteQty: "1", realizedPnl: "0", commission: "0.01", commissionAsset: "USDT", maker: false, time: 2 },
    ]);
    expect(t.map((x) => x.id)).toEqual([2, 1]);
    expect(parseDualSide({ dualSidePosition: true })).toBe(true);
    expect(parseDualSide({ dualSidePosition: false })).toBe(false);
    expect(parseDualSide([])).toBeUndefined();
    expect(parseMaxLeverage({ symbol: "BTCUSDT", brackets: [{ initialLeverage: 50 }, { initialLeverage: 20 }] }, "BTCUSDT")).toBe(50);
    expect(parseMaxLeverage([{ symbol: "ETHUSDT", brackets: [{ initialLeverage: 75 }] }], "BTCUSDT")).toBeUndefined();
  });
});
