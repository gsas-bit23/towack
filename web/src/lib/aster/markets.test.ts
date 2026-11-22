import { describe, expect, it } from "vitest";
import info from "./__fixtures__/exchangeInfo.json";
import { fmtCompactUsd, fmtFunding, fmtPrice, mergeMarkets, tickDecimals, parseExchangeInfo, trimDecimal } from "./markets";

describe("parseExchangeInfo", () => {
  const rules = parseExchangeInfo(info);
  it("keeps only TRADING perpetuals", () => {
    expect([...rules.keys()].sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
  it("reads PRICE_FILTER / LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL", () => {
    const btc = rules.get("BTCUSDT")!;
    expect(btc).toMatchObject({ base: "BTC", quote: "USDT", tickSize: "0.1", stepSize: "0.001", minQty: "0.001", marketMaxQty: "120", minNotional: "5" });
    expect(btc.orderTypes).toContain("LIMIT");
  });
  it("survives junk", () => {
    expect(parseExchangeInfo(null).size).toBe(0);
    expect(parseExchangeInfo({ symbols: [null, { contractType: "PERPETUAL", status: "TRADING" }] }).size).toBe(0);
  });
});

describe("mergeMarkets", () => {
  it("joins ticker + premium index and sorts by quote volume", () => {
    const rules = parseExchangeInfo(info);
    const rows = mergeMarkets(
      rules,
      [
        { symbol: "BTCUSDT", lastPrice: "60812.2", priceChangePercent: "0.997", quoteVolume: "460065840.90" },
        { symbol: "ETHUSDT", lastPrice: "3000", priceChangePercent: "-1.5", quoteVolume: "900000000" },
        { symbol: "NOPE", lastPrice: "1" },
      ],
      [{ symbol: "BTCUSDT", markPrice: "60815.62", indexPrice: "60843.34", lastFundingRate: "0.00002310", nextFundingTime: 1795392000000 }],
    );
    expect(rows.map((r) => r.symbol)).toEqual(["ETHUSDT", "BTCUSDT"]);
    expect(rows[1]).toMatchObject({ priceDecimals: 1, lastPrice: "60812.2", changePct: 0.997, markPrice: "60815.62", fundingRate: 0.0000231, nextFundingTime: 1795392000000 });
    expect(rows[0].markPrice).toBeUndefined();
  });
});

describe("formatters", () => {
  it("funding as signed %", () => {
    expect(fmtFunding(0.0000231)).toBe("+0.0023%");
    expect(fmtFunding(-0.0001)).toBe("-0.0100%");
    expect(fmtFunding(undefined)).toBe("—");
  });
  it("compact usd and trimmed decimals", () => {
    expect(fmtCompactUsd(460065840.9)).toBe("$460.07M");
    expect(fmtCompactUsd(1.2e9)).toBe("$1.20B");
    expect(trimDecimal("60815.62305000")).toBe("60815.62305");
    expect(trimDecimal("5.000")).toBe("5");
    expect(trimDecimal("0.000")).toBe("0");
    expect(trimDecimal(undefined)).toBe("—");
    expect(tickDecimals("0.10")).toBe(1);
    expect(tickDecimals("1")).toBe(0);
    expect(fmtPrice("60854.13378385", 1)).toBe("60854.1");
    expect(fmtPrice(undefined, 1)).toBe("—");
  });
});
