import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import bnbToBase from "./__fixtures__/relay-bnb-to-base-eth.json";
import usdtToBase from "./__fixtures__/relay-usdt-to-base-usdc.json";
import {
  ADDRESS_THIS,
  applySlippage,
  buildAmmTx,
  defaultProviders,
  EEEE,
  executionPlan,
  getBestRoutes,
  isRelayTerminal,
  normalizeOneInch,
  normalizeRelay,
  normalizeZeroEx,
  ONEINCH_ROUTER_V6,
  ORIGIN_TOKENS,
  pancakeV2,
  pancakeV3,
  relayProvider,
  relayQuoteBody,
  relayStatus,
  RELAY_DESTINATIONS,
  scoreQuotes,
  slippageWarning,
  uniswapV3,
  V2_ROUTER_ABI,
  V3_ROUTER_ABI,
  VENUES,
  zeroExProvider,
  oneInchProvider,
  type FetchLike,
  type Quote,
  type QuoteRequest,
  type Reader,
} from "./index";

const USER = getAddress("0x1111111111111111111111111111111111111111");
const [BNB, USDT, USDC, , , CAKE] = ORIGIN_TOKENS[56];
const BASE_ETH = RELAY_DESTINATIONS.find((c) => c.id === 8453)!.tokens[0];
const BASE_USDC = RELAY_DESTINATIONS.find((c) => c.id === 8453)!.tokens[1];
const V = VENUES[56];
const E18 = 10n ** 18n;

const req = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  tokenIn: BNB,
  tokenOut: USDT,
  amountIn: E18 / 10n,
  slippageBps: 100,
  user: USER,
  gasPriceWei: 100_000_000n,
  ...over,
});

/** Fake reader: answers getAmountsOut by path key and quoteExactInputSingle by (quoter, fee). */
function fakeReader(opts: { v2?: Record<string, bigint>; v3?: Record<string, bigint | Error> }): Reader & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async readContract(a) {
      calls.push(a);
      if (a.functionName === "getAmountsOut") {
        const [amountIn, path] = a.args as [bigint, Address[]];
        const key = path.map((p) => p.toLowerCase()).join(">");
        const out = opts.v2?.[key];
        if (out === undefined) throw new Error("PancakeLibrary: INSUFFICIENT_LIQUIDITY");
        return [amountIn, ...path.slice(1, -1).map(() => 1n), out];
      }
      if (a.functionName === "quoteExactInputSingle") {
        const p = (a.args as [{ fee: number }])[0];
        const r = opts.v3?.[`${a.address.toLowerCase()}:${p.fee}`];
        if (r === undefined || r instanceof Error) throw r ?? new Error("execution reverted");
        return [r, 0n, 1, 90_000n];
      }
      throw new Error(`unexpected ${a.functionName}`);
    },
  };
}

const k = (...a: Address[]) => a.map((x) => x.toLowerCase()).join(">");

function jsonFetch(handler: (url: string, init?: Parameters<FetchLike>[1]) => { status?: number; body: unknown }) {
  const mock = vi.fn(async (url: string, init?: Parameters<FetchLike>[1]) => {
    const r = handler(url, init);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  });
  return mock as typeof mock & FetchLike;
}

const noFetch = jsonFetch(() => {
  throw new Error("network must not be used");
});

describe("slippage", () => {
  it("applies bps and clamps", () => {
    expect(applySlippage(10_000n, 100)).toBe(9_900n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 20_000)).toBe(0n);
    expect(slippageWarning(50)).toBe("ok");
    expect(slippageWarning(500)).toBe("high");
    expect(slippageWarning(2000)).toBe("extreme");
  });
});

describe("PancakeSwap v2", () => {
  it("quotes BNB → USDT through WBNB and builds swapExactETHForTokens", async () => {
    const reader = fakeReader({ v2: { [k(V.wrappedNative, USDT.address)]: 55n * E18 } });
    const q = await pancakeV2.quote(req(), { reader, fetch: noFetch });
    expect(q.amountOut).toBe(55n * E18);
    expect(q.minAmountOut).toBe((55n * E18 * 99n) / 100n);
    expect(q.approval).toBeUndefined();
    expect(q.gasCostWei).toBe(q.gasUnits * 100_000_000n);
    const tx = buildAmmTx(q, { recipient: USER, deadline: 1234n });
    expect(tx.to).toBe(V.pancakeV2!.router);
    expect(tx.value).toBe(E18 / 10n);
    const d = decodeFunctionData({ abi: V2_ROUTER_ABI, data: tx.data });
    expect(d.functionName).toBe("swapExactETHForTokens");
    expect(d.args).toEqual([q.minAmountOut, [V.wrappedNative, USDT.address], USER, 1234n]);
  });

  it("picks the 2-hop path when it pays more, and needs an exact approval for ERC-20 input", async () => {
    const reader = fakeReader({
      v2: { [k(USDT.address, CAKE.address)]: 10n * E18, [k(USDT.address, V.wrappedNative, CAKE.address)]: 12n * E18 },
    });
    const q = await pancakeV2.quote(req({ tokenIn: USDT, tokenOut: CAKE, amountIn: 50n * E18 }), { reader, fetch: noFetch });
    expect(q.amountOut).toBe(12n * E18);
    expect(q.route).toContain("WBNB");
    expect(q.approval).toEqual({ token: USDT.address, spender: V.pancakeV2!.router, amount: 50n * E18 });
    const d = decodeFunctionData({ abi: V2_ROUTER_ABI, data: buildAmmTx(q, { recipient: USER, deadline: 1n }).data });
    expect(d.functionName).toBe("swapExactTokensForTokens");
  });

  it("uses swapExactTokensForETH for native output", async () => {
    const reader = fakeReader({ v2: { [k(USDT.address, V.wrappedNative)]: E18 / 50n } });
    const q = await pancakeV2.quote(req({ tokenIn: USDT, tokenOut: BNB, amountIn: 11n * E18 }), { reader, fetch: noFetch });
    const tx = buildAmmTx(q, { recipient: USER, deadline: 9n });
    expect(tx.value).toBe(0n);
    expect(decodeFunctionData({ abi: V2_ROUTER_ABI, data: tx.data }).functionName).toBe("swapExactTokensForETH");
  });

  it("throws when no path has liquidity", async () => {
    await expect(pancakeV2.quote(req(), { reader: fakeReader({}), fetch: noFetch })).rejects.toThrow(/liquidity/);
  });

  it("refuses same-asset / cross-chain requests", () => {
    expect(pancakeV2.supports(req({ tokenOut: BNB }))).toBe(false);
    expect(pancakeV2.supports(req({ tokenOut: BASE_ETH }))).toBe(false);
    expect(pancakeV2.supports(req({ amountIn: 0n }))).toBe(false);
  });
});

describe("v3 (PancakeSwap + Uniswap)", () => {
  it("picks the best fee tier and ignores reverting tiers", async () => {
    const qa = V.uniswapV3!.quoter.toLowerCase();
    const reader = fakeReader({ v3: { [`${qa}:100`]: 50n * E18, [`${qa}:500`]: 56n * E18, [`${qa}:3000`]: new Error("no pool") } });
    const q = await uniswapV3.quote(req(), { reader, fetch: noFetch });
    expect(q.amountOut).toBe(56n * E18);
    expect(q.route).toContain("0.05% pool");
    expect(q.amm).toMatchObject({ kind: "v3", fee: 500, router: V.uniswapV3!.router, tokenIn: V.wrappedNative });
    const tx = buildAmmTx(q, { recipient: USER, deadline: 77n });
    const mc = decodeFunctionData({ abi: V3_ROUTER_ABI, data: tx.data });
    expect(mc.functionName).toBe("multicall");
    const [deadline, calls] = mc.args as [bigint, `0x${string}`[]];
    expect(deadline).toBe(77n);
    expect(calls).toHaveLength(1);
    const inner = decodeFunctionData({ abi: V3_ROUTER_ABI, data: calls[0] });
    expect(inner.functionName).toBe("exactInputSingle");
    expect(inner.args[0]).toMatchObject({ recipient: USER, amountIn: E18 / 10n, amountOutMinimum: q.minAmountOut, fee: 500 });
    expect(tx.value).toBe(E18 / 10n);
  });

  it("native output: swaps to the router (ADDRESS_THIS) then unwrapWETH9 to the user", async () => {
    const qa = V.pancakeV3!.quoter.toLowerCase();
    const reader = fakeReader({ v3: { [`${qa}:100`]: E18 / 55n } });
    const q = await pancakeV3.quote(req({ tokenIn: USDT, tokenOut: BNB, amountIn: E18 }), { reader, fetch: noFetch });
    expect(q.approval?.spender).toBe(V.pancakeV3!.router);
    const tx = buildAmmTx(q, { recipient: USER, deadline: 5n });
    const [, calls] = decodeFunctionData({ abi: V3_ROUTER_ABI, data: tx.data }).args as [bigint, `0x${string}`[]];
    expect(calls).toHaveLength(2);
    expect(decodeFunctionData({ abi: V3_ROUTER_ABI, data: calls[0] }).args[0]).toMatchObject({ recipient: ADDRESS_THIS });
    const unwrap = decodeFunctionData({ abi: V3_ROUTER_ABI, data: calls[1] });
    expect(unwrap.functionName).toBe("unwrapWETH9");
    expect(unwrap.args).toEqual([q.minAmountOut, USER]);
  });

  it("Uniswap is not offered on BSC testnet", () => {
    const [tbnb, tusdt] = ORIGIN_TOKENS[97];
    expect(uniswapV3.supports(req({ tokenIn: tbnb, tokenOut: tusdt }))).toBe(false);
    expect(pancakeV3.supports(req({ tokenIn: tbnb, tokenOut: tusdt }))).toBe(true);
  });
});

describe("Relay", () => {
  it("builds a keyless quote body", () => {
    const body = relayQuoteBody(req({ tokenOut: BASE_ETH, slippageBps: 50 }));
    expect(body).toMatchObject({
      user: USER,
      recipient: USER,
      originChainId: 56,
      destinationChainId: 8453,
      originCurrency: "0x0000000000000000000000000000000000000000",
      amount: (E18 / 10n).toString(),
      tradeType: "EXACT_INPUT",
      slippageTolerance: "50",
    });
  });

  it("normalizes a native cross-chain quote (recorded response)", () => {
    const q = normalizeRelay(req({ tokenOut: BASE_ETH }), bnbToBase);
    expect(q.crossChain).toBe(true);
    expect(q.amountOut).toBe(BigInt(bnbToBase.details.currencyOut.amount));
    expect(q.minAmountOut).toBe(BigInt(bnbToBase.details.currencyOut.minimumAmount));
    expect(q.gasCostWei).toBe(BigInt(bnbToBase.fees.gas.amount));
    expect(q.txs).toHaveLength(1);
    expect(q.txs![0].value).toBe(E18 / 10n);
    expect(q.approval).toBeUndefined();
    expect(q.relayRequestId).toBe(bnbToBase.requestId);
    expect(q.feeNote).toMatch(/Relay fee/);
    expect(q.priceImpactPct).toBeLessThan(0);
  });

  it("replaces Relay's approve step with an exact approval to the same spender", () => {
    const q = normalizeRelay(req({ tokenIn: USDT, tokenOut: BASE_USDC, amountIn: 50n * E18 }), usdtToBase);
    expect(q.approval).toEqual({ token: USDT.address, spender: getAddress("0x4cd00e387622c35bddb9b4c962c136462338bc31"), amount: 50n * E18 });
    expect(q.txs).toHaveLength(1);
    expect(q.txs![0].to).toBe(getAddress("0x4cd00e387622c35bddb9b4c962c136462338bc31"));
  });

  it("rejects signature steps, foreign-chain txs and bogus approvals", () => {
    const sig = { ...bnbToBase, steps: [{ id: "authorize", kind: "signature", items: [] }] };
    expect(() => normalizeRelay(req({ tokenOut: BASE_ETH }), sig)).toThrow(/signature/);
    const foreign = structuredClone(bnbToBase);
    foreign.steps[0].items[0].data.chainId = 1;
    expect(() => normalizeRelay(req({ tokenOut: BASE_ETH }), foreign)).toThrow(/another chain/);
    const bad = structuredClone(usdtToBase);
    bad.steps[0].items[0].data.data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [USER, 1n] });
    expect(() => normalizeRelay(req({ tokenIn: USDT, tokenOut: BASE_USDC, amountIn: 50n * E18 }), bad)).toThrow(/approve/);
  });

  it("POSTs to /quote and surfaces API errors", async () => {
    const ok = jsonFetch((url, init) => {
      expect(url).toBe("https://api.relay.link/quote");
      expect(init?.method).toBe("POST");
      expect(init?.headers?.["x-api-key"]).toBeUndefined();
      return { body: bnbToBase };
    });
    const q = await relayProvider().quote(req({ tokenOut: BASE_ETH }), { fetch: ok });
    expect(q.provider).toBe("relay");
    const bad = jsonFetch(() => ({ status: 400, body: { message: "Amount is too low", errorCode: "AMOUNT_TOO_LOW" } }));
    await expect(relayProvider().quote(req({ tokenOut: BASE_ETH }), { fetch: bad })).rejects.toThrow("Amount is too low");
  });

  it("only quotes from BNB Chain mainnet (no BSC testnet on Relay)", () => {
    const [tbnb, tusdt] = ORIGIN_TOKENS[97];
    expect(relayProvider().supports(req({ tokenIn: tbnb, tokenOut: tusdt }))).toBe(false);
    expect(relayProvider().supports(req({ tokenOut: BASE_ETH }))).toBe(true);
  });

  it("reads intent status", async () => {
    const f = jsonFetch((url) => {
      expect(url).toContain("/intents/status/v2?requestId=0xabc");
      return { body: { status: "success", txHashes: ["0x1"] } };
    });
    expect(await relayStatus("0xabc", f)).toEqual({ status: "success", txHashes: ["0x1"] });
    expect(isRelayTerminal("pending")).toBe(false);
    expect(isRelayTerminal("refund")).toBe(true);
  });
});

describe("0x and 1inch (key-gated)", () => {
  it("are skipped without a key and never call the network", async () => {
    const r = await getBestRoutes(req(), [zeroExProvider({}), oneInchProvider({})], { fetch: noFetch });
    expect(r.skipped).toEqual(["zeroex", "oneinch"]);
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("0x: sends key + version headers and normalizes allowance-holder quotes", async () => {
    const f = jsonFetch((url, init) => {
      expect(url).toContain("/swap/allowance-holder/quote?");
      expect(url).toContain(`sellToken=${EEEE}`);
      expect(init?.headers).toMatchObject({ "0x-api-key": "k", "0x-version": "v2" });
      return {
        body: {
          liquidityAvailable: true,
          buyAmount: "56000000000000000000",
          minBuyAmount: "55440000000000000000",
          transaction: { to: "0x0000000000001fF3684f28c67538d4D072C22734", data: "0xabcd", value: "100000000000000000", gas: "200000", gasPrice: "100000000" },
          issues: { allowance: null },
          route: { fills: [{ source: "PancakeSwap_V3" }, { source: "Uniswap_V3" }] },
        },
      };
    });
    const q = await zeroExProvider({ apiKey: "k" }).quote(req(), { fetch: f });
    expect(q.amountOut).toBe(56n * E18);
    expect(q.minAmountOut).toBe(5544n * 10n ** 16n);
    expect(q.gasCostWei).toBe(200_000n * 100_000_000n);
    expect(q.route).toContain("PancakeSwap_V3 + Uniswap_V3");
    const erc = normalizeZeroEx(req({ tokenIn: USDT, tokenOut: BNB }), {
      buyAmount: "1",
      transaction: { to: "0x0000000000001fF3684f28c67538d4D072C22734", data: "0x01" },
      issues: { allowance: { spender: "0x0000000000001fF3684f28c67538d4D072C22734" } },
    });
    expect(erc.approval?.spender).toBe(getAddress("0x0000000000001fF3684f28c67538d4D072C22734"));
    expect(() => normalizeZeroEx(req(), { liquidityAvailable: false })).toThrow(/liquidity/);
  });

  it("1inch: bearer auth, percent slippage, router v6 spender", async () => {
    const f = jsonFetch((url, init) => {
      expect(url).toContain("/swap/v6.0/56/swap?");
      expect(url).toContain("slippage=1");
      expect(init?.headers?.Authorization).toBe("Bearer k");
      return { body: { dstAmount: "1000", tx: { to: ONEINCH_ROUTER_V6, data: "0x12", value: "0", gas: 150000 } } };
    });
    const q = await oneInchProvider({ apiKey: "k" }).quote(req({ tokenIn: USDT, tokenOut: USDC, amountIn: E18 }), { fetch: f });
    expect(q.amountOut).toBe(1000n);
    expect(q.minAmountOut).toBe(990n);
    expect(q.approval).toEqual({ token: USDT.address, spender: ONEINCH_ROUTER_V6, amount: E18 });
    expect(() => normalizeOneInch(req(), { dstAmount: "1" })).toThrow(/incomplete/);
  });
});

const fakeQuote = (over: Partial<Quote>): Quote => ({
  provider: "pancakeV2",
  label: "x",
  tokenIn: BNB,
  tokenOut: USDT,
  amountIn: E18,
  amountOut: 0n,
  minAmountOut: 0n,
  gasUnits: 0n,
  gasCostWei: 0n,
  route: "",
  crossChain: false,
  ...over,
});

describe("best route scoring", () => {
  it("subtracts gas in output units (BNB input: uses the quoted rate)", () => {
    // 1 BNB -> 600 USDT. Route A: 600 USDT, 0.01 BNB gas (= 6 USDT). Route B: 597 USDT, 0.001 BNB gas (= 0.6 USDT).
    const a = fakeQuote({ provider: "uniswapV3", amountOut: 600n * E18, gasCostWei: E18 / 100n, gasUnits: 300_000n });
    const b = fakeQuote({ provider: "pancakeV3", amountOut: 597n * E18, gasCostWei: E18 / 1000n, gasUnits: 150_000n });
    const [first, second] = scoreQuotes([a, b], { tokenIn: BNB, tokenOut: USDT, amountIn: E18 });
    expect(first.provider).toBe("pancakeV3");
    expect(first.best).toBe(true);
    expect(first.gasScored).toBe(true);
    expect(second.gasInOut).toBe(6n * E18);
    expect(first.netOut).toBe(597n * E18 - (6n * E18) / 10n);
    expect(second.vsBestBps).toBeLessThan(0);
  });

  it("native output prices gas 1:1", () => {
    const a = fakeQuote({ tokenIn: USDT, tokenOut: BNB, amountIn: E18, amountOut: 100n, gasCostWei: 50n });
    const b = fakeQuote({ tokenIn: USDT, tokenOut: BNB, amountIn: E18, amountOut: 90n, gasCostWei: 0n, provider: "relay" });
    const r = scoreQuotes([a, b], { tokenIn: USDT, tokenOut: BNB, amountIn: E18 });
    expect(r[0].provider).toBe("relay");
    expect(r[1].netOut).toBe(50n);
  });

  it("token → token without a reference ranks by amountOut and says gas was not scored", () => {
    const a = fakeQuote({ tokenIn: USDT, tokenOut: CAKE, amountOut: 10n, gasCostWei: E18 });
    const b = fakeQuote({ tokenIn: USDT, tokenOut: CAKE, amountOut: 11n, gasCostWei: 2n * E18, provider: "uniswapV3" });
    const r = scoreQuotes([a, b], { tokenIn: USDT, tokenOut: CAKE, amountIn: E18 });
    expect(r[0].provider).toBe("uniswapV3");
    expect(r[0].gasScored).toBe(false);
    // With a reference (1 BNB = 5 CAKE units), b's extra gas costs 5 more units and a wins.
    const r2 = scoreQuotes([a, b], { tokenIn: USDT, tokenOut: CAKE, amountIn: E18 }, { nativeToOut: 5n });
    expect(r2[0].provider).toBe("pancakeV2");
  });

  it("ties break on gas, then provider order", () => {
    const a = fakeQuote({ provider: "pancakeV2", amountOut: 10n, gasUnits: 200n });
    const b = fakeQuote({ provider: "uniswapV3", amountOut: 10n, gasUnits: 100n });
    const c = fakeQuote({ provider: "pancakeV3", amountOut: 10n, gasUnits: 100n });
    expect(scoreQuotes([a, b, c], { tokenIn: USDT, tokenOut: CAKE, amountIn: 1n }).map((q) => q.provider)).toEqual(["pancakeV3", "uniswapV3", "pancakeV2"]);
  });

  it("getBestRoutes: runs providers in parallel, collects errors and timeouts, picks the best", async () => {
    const reader = fakeReader({
      v2: { [k(V.wrappedNative, USDT.address)]: 55n * E18 },
      v3: { [`${V.pancakeV3!.quoter.toLowerCase()}:500`]: 56n * E18 },
    });
    const hang = { ...uniswapV3, quote: () => new Promise<Quote>(() => {}) };
    const f = jsonFetch(() => ({ status: 500, body: { message: "Relay is down" } }));
    const r = await getBestRoutes(req(), [pancakeV3, hang, pancakeV2, relayProvider(), zeroExProvider({})], { reader, fetch: f }, { timeoutMs: 50 });
    expect(r.best?.provider).toBe("pancakeV3");
    expect(r.quotes.map((q) => q.provider)).toEqual(["pancakeV3", "pancakeV2"]);
    expect(r.errors.map((e) => e.provider).sort()).toEqual(["relay", "uniswapV3"]);
    expect(r.errors.find((e) => e.provider === "uniswapV3")?.error).toMatch(/timed out/);
    expect(r.errors.find((e) => e.provider === "relay")?.error).toBe("Relay is down");
    expect(r.skipped).toEqual(["zeroex"]);
  });

  it("cross-chain: only Relay is asked", async () => {
    const f = jsonFetch(() => ({ body: bnbToBase }));
    const r = await getBestRoutes(req({ tokenOut: BASE_ETH }), defaultProviders(), { reader: fakeReader({}), fetch: f });
    expect(r.quotes.map((q) => q.provider)).toEqual(["relay"]);
    expect(r.skipped).toEqual(["pancakeV3", "uniswapV3", "pancakeV2", "zeroex", "oneinch"]);
  });
});

describe("execution plan", () => {
  it("skips the approval when the allowance covers it and builds a fresh AMM deadline", async () => {
    const reader = fakeReader({ v2: { [k(USDT.address, V.wrappedNative)]: E18 } });
    const q = await pancakeV2.quote(req({ tokenIn: USDT, tokenOut: BNB, amountIn: 5n * E18 }), { reader, fetch: noFetch });
    const p1 = executionPlan(q, { recipient: USER, nowSec: 1000, allowance: 0n });
    expect(p1.approval?.amount).toBe(5n * E18);
    const p2 = executionPlan(q, { recipient: USER, nowSec: 1000, deadlineSec: 60, allowance: 5n * E18 });
    expect(p2.approval).toBeUndefined();
    const args = decodeFunctionData({ abi: V2_ROUTER_ABI, data: p2.txs[0].data }).args as readonly unknown[];
    expect(args[4]).toBe(1060n);
  });

  it("passes provider txs through for API routes", () => {
    const q = normalizeRelay(req({ tokenOut: BASE_ETH }), bnbToBase);
    expect(executionPlan(q, { recipient: USER, nowSec: 0 }).txs).toBe(q.txs);
  });
});
