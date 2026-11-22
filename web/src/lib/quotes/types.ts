import type { Abi, Address } from "viem";

export type Hex = `0x${string}`;

/**
 * A token on some chain. Native coins (BNB, ETH, POL...) use the zero address, which is also Relay's convention.
 * Adapters translate to their own marker (WBNB for AMMs, 0xEeee... for 0x / 1inch).
 */
export type Token = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
};

export type ProviderId = "relay" | "pancakeV2" | "pancakeV3" | "uniswapV3" | "zeroex" | "oneinch";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  relay: "Relay",
  pancakeV2: "PancakeSwap v2",
  pancakeV3: "PancakeSwap v3",
  uniswapV3: "Uniswap v3",
  zeroex: "0x",
  oneinch: "1inch",
};

export const PROVIDER_SITE: Record<ProviderId, string> = {
  relay: "https://relay.link",
  pancakeV2: "https://pancakeswap.finance",
  pancakeV3: "https://pancakeswap.finance",
  uniswapV3: "https://app.uniswap.org",
  zeroex: "https://0x.org",
  oneinch: "https://1inch.io",
};

export type QuoteRequest = {
  tokenIn: Token; // always on the origin chain (the chain the user signs on)
  tokenOut: Token; // same chain = swap; another chain = bridge (+ swap), Relay only
  amountIn: bigint;
  slippageBps: number; // 50 = 0.5%
  user: Address; // the wallet that will sign; used by HTTP APIs that build calldata
  recipient?: Address; // defaults to user
  gasPriceWei?: bigint; // origin-chain gas price for the cost estimate; adapters fall back to DEFAULT_GAS_PRICE_WEI
};

/** A transaction the user's own wallet signs. Never signed or sent by Towack. */
export type TxRequest = { chainId: number; to: Address; data: Hex; value: bigint; gas?: bigint };

/** An exact ERC-20 approval the user must sign before the swap (never unlimited). */
export type Approval = { token: Address; spender: Address; amount: bigint };

/** Enough to rebuild an AMM router call later with a fresh deadline (see `buildAmmTx`). */
export type AmmPlan =
  | { kind: "v2"; router: Address; path: Address[]; nativeIn: boolean; nativeOut: boolean }
  | { kind: "v3"; router: Address; tokenIn: Address; tokenOut: Address; fee: number; nativeIn: boolean; nativeOut: boolean };

export type Quote = {
  provider: ProviderId;
  label: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOut: bigint; // expected output, already net of provider / relayer fees
  minAmountOut: bigint; // the on-chain floor after slippage
  gasUnits: bigint; // origin-chain gas estimate for the swap tx(s), excluding a possible approval
  gasCostWei: bigint; // gasUnits * gas price, in origin native (BNB)
  route: string; // human-readable, e.g. "WBNB → USDT · 0.05% pool"
  crossChain: boolean;
  etaSeconds?: number;
  priceImpactPct?: number; // negative = worse (Relay convention)
  feeNote?: string;
  approval?: Approval; // only when tokenIn is an ERC-20
  amm?: AmmPlan; // AMM routes: tx is built at execute time with a fresh deadline
  txs?: TxRequest[]; // API routes: ready-made txs from the provider (excluding approval)
  relayRequestId?: string;
};

export type ProviderError = { provider: ProviderId; label: string; error: string };

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: ProviderError };

/** Minimal on-chain reader (a viem PublicClient fits). Injected so tests can mock it. */
export type Reader = {
  readContract: (args: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) => Promise<unknown>;
};

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type ProviderCtx = { reader?: Reader; fetch: FetchLike; signal?: AbortSignal; nowSec?: number };

export type Provider = {
  id: ProviderId;
  /** Cheap, synchronous: is this pair / chain / key combination something the provider can quote? */
  supports: (req: QuoteRequest) => boolean;
  quote: (req: QuoteRequest, ctx: ProviderCtx) => Promise<Quote>;
};

/** BSC base fee is tiny (~0.05–0.1 gwei in late 2026). Used only when the caller passes no gas price. */
export const DEFAULT_GAS_PRICE_WEI = 100_000_000n; // 0.1 gwei

export const BPS = 10_000n;

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  const s = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amount * (BPS - s)) / BPS;
}
