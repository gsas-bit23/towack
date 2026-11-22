import { getAddress, type Address } from "viem";
import { EEEE, isNative } from "./tokens";
import { applySlippage, DEFAULT_GAS_PRICE_WEI, PROVIDER_LABEL, type Hex, type Provider, type Quote, type QuoteRequest } from "./types";

/**
 * 0x and 1inch need an API key (free tiers exist, but both require a signup), so they are OFF unless a key is set:
 * NEXT_PUBLIC_ZEROX_API_KEY / NEXT_PUBLIC_ONEINCH_API_KEY. Anything NEXT_PUBLIC_* ships to the browser, so only use a
 * key whose provider allows client-side use, or point NEXT_PUBLIC_ONEINCH_API_URL at your own proxy (1inch does not
 * send CORS headers to arbitrary sites). Both return ready-made calldata for the user's own wallet.
 */

const asApiToken = (t: QuoteRequest["tokenIn"]): Address => (isNative(t) ? EEEE : t.address);
const sameChain = (req: QuoteRequest) => req.tokenIn.chainId === req.tokenOut.chainId && req.amountIn > 0n;

export const ZEROX_API = "https://api.0x.org";
/** 0x v2 AllowanceHolder: the approval spender for allowance-holder quotes. */
export const ZEROX_CHAINS = [56];

type ZeroExQuote = {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  transaction?: { to?: string; data?: string; value?: string; gas?: string; gasPrice?: string };
  issues?: { allowance?: { spender?: string; actual?: string } | null };
  route?: { fills?: { source?: string }[] };
  message?: string;
  name?: string;
};

export function zeroExProvider(opts: { apiKey?: string; apiUrl?: string }): Provider {
  const base = (opts.apiUrl ?? ZEROX_API).replace(/\/$/, "");
  return {
    id: "zeroex",
    supports: (req) => Boolean(opts.apiKey) && sameChain(req) && ZEROX_CHAINS.includes(req.tokenIn.chainId),
    async quote(req, ctx) {
      if (!opts.apiKey) throw new Error("0x needs NEXT_PUBLIC_ZEROX_API_KEY");
      const qs = new URLSearchParams({
        chainId: String(req.tokenIn.chainId),
        sellToken: asApiToken(req.tokenIn),
        buyToken: asApiToken(req.tokenOut),
        sellAmount: req.amountIn.toString(),
        taker: req.user,
        slippageBps: String(Math.round(req.slippageBps)),
      });
      const res = await ctx.fetch(`${base}/swap/allowance-holder/quote?${qs}`, {
        headers: { "0x-api-key": opts.apiKey, "0x-version": "v2" },
        signal: ctx.signal,
      });
      const body = (await res.json().catch(() => ({}))) as ZeroExQuote;
      if (!res.ok) throw new Error(body.message || body.name || `0x quote failed (HTTP ${res.status})`);
      return normalizeZeroEx(req, body);
    },
  };
}

export function normalizeZeroEx(req: QuoteRequest, body: ZeroExQuote): Quote {
  if (body.liquidityAvailable === false) throw new Error("0x found no liquidity for this pair");
  const tx = body.transaction;
  if (!body.buyAmount || !tx?.to || !tx.data) throw new Error("0x returned an incomplete quote");
  const gasUnits = BigInt(tx.gas ?? "0");
  const gasPrice = tx.gasPrice ? BigInt(tx.gasPrice) : (req.gasPriceWei ?? DEFAULT_GAS_PRICE_WEI);
  const spender = body.issues?.allowance?.spender;
  const sources = [...new Set((body.route?.fills ?? []).map((f) => f.source).filter(Boolean))];
  return {
    provider: "zeroex",
    label: PROVIDER_LABEL.zeroex,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: BigInt(body.buyAmount),
    minAmountOut: body.minBuyAmount ? BigInt(body.minBuyAmount) : applySlippage(BigInt(body.buyAmount), req.slippageBps),
    gasUnits,
    gasCostWei: gasUnits * gasPrice,
    route: `${req.tokenIn.symbol} → ${req.tokenOut.symbol}${sources.length ? ` · ${sources.join(" + ")}` : ""}`,
    crossChain: false,
    approval: isNative(req.tokenIn) ? undefined : { token: req.tokenIn.address, spender: getAddress(spender ?? tx.to), amount: req.amountIn },
    txs: [{ chainId: req.tokenIn.chainId, to: getAddress(tx.to), data: tx.data as Hex, value: BigInt(tx.value ?? "0"), gas: gasUnits || undefined }],
  };
}

export const ONEINCH_API = "https://api.1inch.dev";
/** 1inch Aggregation Router v6 (same address on every chain); the approval spender. */
export const ONEINCH_ROUTER_V6: Address = "0x111111125421cA6dc452d289314280a0f8842A65";
export const ONEINCH_CHAINS = [56];

type OneInchSwap = {
  dstAmount?: string;
  tx?: { to?: string; data?: string; value?: string; gas?: number | string; gasPrice?: string };
  description?: string;
  error?: string;
};

export function oneInchProvider(opts: { apiKey?: string; apiUrl?: string }): Provider {
  const base = (opts.apiUrl ?? ONEINCH_API).replace(/\/$/, "");
  return {
    id: "oneinch",
    supports: (req) => Boolean(opts.apiKey) && sameChain(req) && ONEINCH_CHAINS.includes(req.tokenIn.chainId),
    async quote(req, ctx) {
      if (!opts.apiKey) throw new Error("1inch needs NEXT_PUBLIC_ONEINCH_API_KEY");
      const qs = new URLSearchParams({
        src: asApiToken(req.tokenIn),
        dst: asApiToken(req.tokenOut),
        amount: req.amountIn.toString(),
        from: req.user,
        origin: req.user,
        receiver: req.recipient ?? req.user,
        slippage: String(req.slippageBps / 100), // 1inch takes percent
        disableEstimate: "true", // quote even before the approval exists; the wallet estimates gas again
      });
      const res = await ctx.fetch(`${base}/swap/v6.0/${req.tokenIn.chainId}/swap?${qs}`, {
        headers: { Authorization: `Bearer ${opts.apiKey}`, accept: "application/json" },
        signal: ctx.signal,
      });
      const body = (await res.json().catch(() => ({}))) as OneInchSwap;
      if (!res.ok) throw new Error(body.description || body.error || `1inch quote failed (HTTP ${res.status})`);
      return normalizeOneInch(req, body);
    },
  };
}

export function normalizeOneInch(req: QuoteRequest, body: OneInchSwap): Quote {
  const tx = body.tx;
  if (!body.dstAmount || !tx?.to || !tx.data) throw new Error("1inch returned an incomplete quote");
  const gasUnits = BigInt(tx.gas ?? 0);
  const gasPrice = tx.gasPrice ? BigInt(tx.gasPrice) : (req.gasPriceWei ?? DEFAULT_GAS_PRICE_WEI);
  const out = BigInt(body.dstAmount);
  return {
    provider: "oneinch",
    label: PROVIDER_LABEL.oneinch,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: out,
    minAmountOut: applySlippage(out, req.slippageBps),
    gasUnits,
    gasCostWei: gasUnits * gasPrice,
    route: `${req.tokenIn.symbol} → ${req.tokenOut.symbol} · 1inch Aggregation Router v6`,
    crossChain: false,
    approval: isNative(req.tokenIn) ? undefined : { token: req.tokenIn.address, spender: ONEINCH_ROUTER_V6, amount: req.amountIn },
    txs: [{ chainId: req.tokenIn.chainId, to: getAddress(tx.to), data: tx.data as Hex, value: BigInt(tx.value ?? "0"), gas: gasUnits || undefined }],
  };
}
