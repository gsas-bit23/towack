import { describe, expect, it } from "vitest";
import { buildSwapInstruction, toMainnetToken } from "./agentSwap";
import { ORIGIN_TOKENS, RELAY_DESTINATIONS, VENUES } from "./quotes";

const [BNB, USDT] = ORIGIN_TOKENS[56];
const [TBNB, TUSDT] = ORIGIN_TOKENS[97];
const BASE_ETH = RELAY_DESTINATIONS.find((c) => c.id === 8453)!.tokens[0];

describe("BAW swap / bridge instructions", () => {
  it("maps testnet tokens to mainnet and marks unknown ones as placeholders", () => {
    expect(toMainnetToken(TBNB).token).toEqual(BNB);
    expect(toMainnetToken(TUSDT).token).toEqual(USDT);
    const twak = { ...TUSDT, symbol: "TWAK", address: "0xBdba6e4630a1B0AcE0FDeBEc65C6C350eBb2e3E4" as const };
    expect(toMainnetToken(twak).placeholder).toBe(true);
    expect(toMainnetToken(twak, "0x1111111111111111111111111111111111111111").token.address).toBe("0x1111111111111111111111111111111111111111");
  });

  it("v3 route: quoter + multicall recipe with mainnet addresses, preview → yes → execute", () => {
    const { text, missing } = buildSwapInstruction({ provider: "pancakeV3", tokenIn: BNB, tokenOut: USDT, amountIn: 10n ** 17n, slippageBps: 50, v3Fee: 100 });
    expect(missing).toEqual([]);
    expect(text).toContain(VENUES[56].pancakeV3!.router);
    expect(text).toContain(VENUES[56].pancakeV3!.quoter);
    expect(text).toContain("--binanceChainId 56");
    expect(text).toContain("baw contract-call preview");
    expect(text).toMatch(/WAIT for my explicit "yes"/);
    expect(text).toContain("--value amountIn");
    expect(text).not.toContain(".approve("); // native in: no approval step
    expect(text).toContain("market-order quote");
  });

  it("v2 ERC-20 → BNB: exact approval step and swapExactTokensForETH", () => {
    const { text } = buildSwapInstruction({ provider: "pancakeV2", tokenIn: USDT, tokenOut: BNB, amountIn: 10n ** 18n, slippageBps: 100 });
    expect(text).toContain(`USDT.approve(${VENUES[56].pancakeV2!.router}, amountIn)`);
    expect(text).toContain("swapExactTokensForETH");
    expect(text).toContain("EXACT amountIn only");
  });

  it("Relay bridge: keyless POST body, step checks, status polling, no market-order alternative", () => {
    const { text } = buildSwapInstruction({ provider: "relay", tokenIn: BNB, tokenOut: BASE_ETH, amountIn: 10n ** 17n, slippageBps: 100 });
    expect(text).toMatch(/^Bridge 0.1 BNB/);
    expect(text).toContain("POST https://api.relay.link/quote");
    expect(text).toContain('"destinationChainId":8453');
    expect(text).toContain("/intents/status/v2");
    expect(text).toContain('kind "transaction"');
    expect(text).not.toContain("market-order");
  });

  it("reports placeholders as missing", () => {
    const { missing, text } = buildSwapInstruction(
      { provider: "pancakeV2", tokenIn: BNB, tokenOut: { ...USDT, symbol: "TWAK" }, amountIn: 1n, slippageBps: 100 },
      { outPlaceholder: true },
    );
    expect(missing).toEqual(["TWAK (mainnet)"]);
    expect(text).toContain("<TWAK_MAINNET_ADDRESS>");
  });

  it("without a route gives a generic, safe instruction", () => {
    expect(buildSwapInstruction(undefined).text).toContain("Pick the amount and tokens on the Towack /swap page first");
  });
});
