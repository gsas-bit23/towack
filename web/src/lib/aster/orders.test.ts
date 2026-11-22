import { describe, expect, it } from "vitest";
import info from "./__fixtures__/exchangeInfo.json";
import { parseExchangeInfo } from "./markets";
import { buildOrder, cancelParams, cleanDecimalInput, cmpDec, floorToStep, leverageParams, parseOpenOrders, parseUsdtBalance } from "./orders";

const btc = parseExchangeInfo(info).get("BTCUSDT")!;

describe("decimal helpers", () => {
  it("floors to step without floats", () => {
    expect(floorToStep("0.0019", "0.001")).toBe("0.001");
    expect(floorToStep("60815.67", "0.1")).toBe("60815.6");
    expect(floorToStep("12", "5")).toBe("10");
    expect(floorToStep("0.3", "0.1")).toBe("0.3");
  });
  it("compares and cleans", () => {
    expect(cmpDec("0.0010", "0.001")).toBe(0);
    expect(cmpDec("0.002", "0.001")).toBe(1);
    expect(cleanDecimalInput("1,5.3a")).toBe("1.53");
  });
});

describe("buildOrder", () => {
  it("limit: rounds down and sends only limit params", () => {
    const r = buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.0019", price: "60000.07", timeInForce: "GTC" }, btc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.params).toEqual([
      ["symbol", "BTCUSDT"],
      ["side", "BUY"],
      ["type", "LIMIT"],
      ["timeInForce", "GTC"],
      ["quantity", "0.001"],
      ["price", "60000"],
    ]);
    expect(r.order.notional).toBeCloseTo(60);
  });
  it("market: no price / timeInForce (Aster rejects extras), notional at mark", () => {
    const r = buildOrder({ symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: "0.002", price: "1", reduceOnly: true, markPrice: "60000" }, btc);
    expect(r.ok && r.order.params).toEqual([
      ["symbol", "BTCUSDT"],
      ["side", "SELL"],
      ["type", "MARKET"],
      ["quantity", "0.002"],
      ["reduceOnly", "true"],
    ]);
  });
  it("rejects below min qty, min notional, over market max, missing price", () => {
    expect(buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.0005", price: "60000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("Minimum size") });
    expect(buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.001", price: "100" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("at least 5") });
    expect(buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "121", markPrice: "60000" }, btc)).toMatchObject({ ok: false, error: expect.stringContaining("Maximum market") });
    expect(buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01" }, btc)).toMatchObject({ ok: false, error: "Enter a limit price." });
    expect(buildOrder({ symbol: "ETHUSDT", side: "BUY", type: "LIMIT", quantity: "1", price: "1" }, btc).ok).toBe(false);
    expect(buildOrder({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "", price: "1" }, btc)).toMatchObject({ ok: false, error: "Enter a size." });
  });
});

describe("other payloads and parsers", () => {
  it("cancel + leverage", () => {
    expect(cancelParams("BTCUSDT", 123)).toEqual([["symbol", "BTCUSDT"], ["orderId", "123"]]);
    expect(leverageParams("BTCUSDT", 5)).toEqual([["symbol", "BTCUSDT"], ["leverage", "5"]]);
    expect(leverageParams("BTCUSDT", 0)).toBeUndefined();
    expect(leverageParams("BTCUSDT", 126)).toBeUndefined();
    expect(leverageParams("BTCUSDT", 2.5)).toBeUndefined();
  });
  it("open orders + balance", () => {
    expect(parseOpenOrders([{ orderId: 1917641, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "50000", origQty: "0.40", executedQty: "0", reduceOnly: false }, { junk: 1 }])).toEqual([
      { orderId: 1917641, symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "50000", origQty: "0.40", executedQty: "0", reduceOnly: false, time: undefined },
    ]);
    expect(parseOpenOrders({ code: -1 })).toEqual([]);
    expect(parseUsdtBalance([{ asset: "BNB" }, { asset: "USDT", balance: "12.5", availableBalance: "10" }])).toEqual({ balance: "12.5", available: "10" });
    expect(parseUsdtBalance([])).toBeUndefined();
  });
});
