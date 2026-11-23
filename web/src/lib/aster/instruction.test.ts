import { describe, expect, it } from "vitest";
import { buildPerpsInstruction, intentParams } from "./instruction";

describe("buildPerpsInstruction", () => {
  const order = buildPerpsInstruction({ kind: "order", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.001", price: "60000", timeInForce: "GTC", leverage: 3, base: "BTC" });

  it("is honest that Aster is not a BSC contract-call", () => {
    expect(order).toContain("Aster orders are NOT a BNB Smart Chain contract call");
    expect(order).toContain("Do not use `baw contract-call`");
  });
  it("uses BAW sign-message preview → yes → execute, chain 56, trade-only scope", () => {
    expect(order).toContain("baw wallet settings --json");
    expect(order).toContain("baw sign-message preview --binanceChainId 56 --signType EIP712");
    expect(order).toContain('WAIT for my explicit "yes"');
    expect(order).toContain("baw sign-message execute --requestId");
    expect(order).toContain("canSpotTrade=false&canPerpTrade=true&canWithdraw=false");
    expect(order.indexOf("sign-message preview")).toBeLessThan(order.indexOf("sign-message execute"));
  });
  it("carries the exact order, leverage step and 1666 trade domain on mainnet", () => {
    expect(order).toContain("Request params: symbol=BTCUSDT&side=BUY&type=LIMIT&timeInForce=GTC&quantity=0.001&price=60000");
    expect(order).toContain("POST https://fapi.asterdex.com/fapi/v3/leverage with symbol=BTCUSDT&leverage=3");
    expect(order).toContain("domain.chainId = 1666");
    expect(order).toContain("POST /fapi/v3/order at https://fapi.asterdex.com");
    expect(order).not.toContain("asterdex-testnet");
    expect(order).toContain("-5050");
  });
  it("keeps placeholders readable and supports cancel", () => {
    expect(intentParams({ kind: "order", symbol: "ETHUSDT", side: "SELL", type: "MARKET", quantity: "" })).toBe("symbol=ETHUSDT&side=SELL&type=MARKET&quantity=<SIZE>");
    const c = buildPerpsInstruction({ kind: "cancel", symbol: "ETHUSDT" });
    expect(c).toContain("DELETE /fapi/v3/order");
    expect(c).toContain("orderId=<ORDER_ID>");
    expect(c).not.toContain("/fapi/v3/leverage");
  });
  it("carries stop / trailing params and attached TP / SL legs in the same layout as buildOrder", () => {
    expect(intentParams({ kind: "order", symbol: "BTCUSDT", side: "BUY", type: "STOP", quantity: "0.002", price: "61000", stopPrice: "60900", timeInForce: "GTC" })).toBe(
      "symbol=BTCUSDT&side=BUY&type=STOP&timeInForce=GTC&quantity=0.002&price=61000&stopPrice=60900",
    );
    expect(intentParams({ kind: "order", symbol: "BTCUSDT", side: "SELL", type: "STOP_MARKET", quantity: "0.002", stopPrice: "59000", workingType: "MARK_PRICE" })).toBe(
      "symbol=BTCUSDT&side=SELL&type=STOP_MARKET&quantity=0.002&stopPrice=59000&workingType=MARK_PRICE",
    );
    expect(intentParams({ kind: "order", symbol: "BTCUSDT", side: "SELL", type: "TRAILING_STOP_MARKET", quantity: "0.002" })).toBe(
      "symbol=BTCUSDT&side=SELL&type=TRAILING_STOP_MARKET&quantity=0.002&callbackRate=<CALLBACK_PCT>",
    );
    const t = buildPerpsInstruction({ kind: "order", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.002", price: "60000", takeProfit: "63000", stopLoss: "58000", marginType: "ISOLATED", leverage: 5 });
    expect(t).toContain("symbol=BTCUSDT&side=SELL&type=TAKE_PROFIT_MARKET&quantity=0.002&stopPrice=63000&reduceOnly=true");
    expect(t).toContain("symbol=BTCUSDT&side=SELL&type=STOP_MARKET&quantity=0.002&stopPrice=58000&reduceOnly=true");
    expect(t).toContain("Only if the entry was accepted");
    expect(t).toContain("not batchOrders");
    expect(t).toContain("POST https://fapi.asterdex.com/fapi/v3/marginType with symbol=BTCUSDT&marginType=ISOLATED");
    expect(t.indexOf("/fapi/v3/marginType")).toBeLessThan(t.indexOf("/fapi/v3/leverage with"));
    expect(t.indexOf("/fapi/v3/leverage with")).toBeLessThan(t.indexOf("TAKE_PROFIT_MARKET&quantity"));
    expect(t).toContain("attached TP 63000, SL 58000 (reduce-only)");
  });
});
