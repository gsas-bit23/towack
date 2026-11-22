import type { Address } from "viem";
import { buildAmmTx } from "./amm";
import { isNativeLike } from "./tokens";
import { BPS, PROVIDER_LABEL, type Approval, type Provider, type ProviderCtx, type ProviderError, type Quote, type QuoteRequest, type TxRequest } from "./types";

/**
 * Best-route scoring (explicit, so the UI can explain it):
 *
 *   netOut = amountOut − gasCostInOut
 *
 * - amountOut is what the provider says you receive, already net of its own fees (Relay relayer fee, AMM pool fee,
 *   aggregator fee). Slippage is not subtracted: every route uses the same slippage setting.
 * - gasCostInOut converts the origin-chain gas estimate (BNB) into output-token units with `outPerNative`
 *   (output units per 1e18 wei of BNB):
 *     1. output is BNB / WBNB on the origin chain        → 1:1
 *     2. input is BNB / WBNB                              → the best raw quote's own rate (amountOut / amountIn)
 *     3. otherwise the caller's `nativeToOut` reference   (e.g. a PancakeSwap v2 quote for 1 BNB → tokenOut)
 *     4. no reference                                    → gas is not scored (gasScored = false); rank by amountOut
 * - Ties break on lower gas, then on provider order (on-chain venues before HTTP APIs).
 * Approval gas is not scored: every ERC-20-input route needs one exact approval to its own spender.
 */

export type ScoredQuote = Quote & { netOut: bigint; gasInOut: bigint; gasScored: boolean; best: boolean; vsBestBps: number };

export const PROVIDER_ORDER = ["pancakeV3", "uniswapV3", "pancakeV2", "relay", "zeroex", "oneinch"] as const;
const ONE = 10n ** 18n;

export function outPerNative(quotes: Quote[], req: Pick<QuoteRequest, "tokenIn" | "tokenOut" | "amountIn">, nativeToOut?: bigint): bigint | undefined {
  const sameChain = req.tokenIn.chainId === req.tokenOut.chainId;
  if (sameChain && isNativeLike(req.tokenOut)) return ONE;
  if (isNativeLike(req.tokenIn) && req.amountIn > 0n && quotes.length > 0) {
    const top = quotes.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    return (top.amountOut * ONE) / req.amountIn;
  }
  return nativeToOut && nativeToOut > 0n ? nativeToOut : undefined;
}

export function scoreQuotes(quotes: Quote[], req: Pick<QuoteRequest, "tokenIn" | "tokenOut" | "amountIn">, opts: { nativeToOut?: bigint } = {}): ScoredQuote[] {
  if (quotes.length === 0) return [];
  const rate = outPerNative(quotes, req, opts.nativeToOut);
  const scored = quotes.map((q) => {
    const gasInOut = rate !== undefined ? (q.gasCostWei * rate) / ONE : 0n;
    return { ...q, gasInOut, netOut: q.amountOut - gasInOut, gasScored: rate !== undefined, best: false, vsBestBps: 0 };
  });
  scored.sort((a, b) => {
    if (a.netOut !== b.netOut) return a.netOut > b.netOut ? -1 : 1;
    if (a.gasUnits !== b.gasUnits) return a.gasUnits < b.gasUnits ? -1 : 1;
    return PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider);
  });
  const top = scored[0];
  top.best = true;
  for (const s of scored) {
    s.vsBestBps = top.netOut > 0n ? Number(((s.netOut - top.netOut) * BPS) / top.netOut) : 0;
  }
  return scored;
}

export type RouteResult = { quotes: ScoredQuote[]; errors: ProviderError[]; best?: ScoredQuote; skipped: Quote["provider"][] };

/** Ask every supporting provider in parallel (each with its own timeout), keep what comes back, rank it. */
export async function getBestRoutes(
  req: QuoteRequest,
  providers: Provider[],
  ctx: ProviderCtx,
  opts: { timeoutMs?: number; nativeToOut?: bigint } = {},
): Promise<RouteResult> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const active = providers.filter((p) => p.supports(req));
  const skipped = providers.filter((p) => !active.includes(p)).map((p) => p.id);
  const settled = await Promise.allSettled(active.map((p) => withTimeout(p.quote(req, ctx), timeoutMs, `${PROVIDER_LABEL[p.id]} timed out`)));
  const quotes: Quote[] = [];
  const errors: ProviderError[] = [];
  settled.forEach((r, i) => {
    const p = active[i];
    if (r.status === "fulfilled") {
      const q = r.value;
      if (q.amountOut > 0n && q.minAmountOut <= q.amountOut) quotes.push(q);
      else errors.push({ provider: p.id, label: PROVIDER_LABEL[p.id], error: "Quote was empty or inconsistent" });
    } else {
      errors.push({ provider: p.id, label: PROVIDER_LABEL[p.id], error: errMsg(r.reason) });
    }
  });
  const scored = scoreQuotes(quotes, req, { nativeToOut: opts.nativeToOut });
  return { quotes: scored, errors, best: scored[0], skipped };
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const short = (e as Error & { shortMessage?: string }).shortMessage;
    return (short || e.message).split("\n")[0].slice(0, 160);
  }
  return String(e).slice(0, 160);
}

/**
 * What the user's wallet will be asked to sign, in order: an optional exact approval (skipped if the current
 * allowance already covers it), then the route's transaction(s). AMM calldata is built here with a fresh deadline.
 */
export function executionPlan(
  q: Quote,
  opts: { recipient: Address; nowSec: number; deadlineSec?: number; allowance?: bigint },
): { approval?: Approval; txs: TxRequest[] } {
  const approval = q.approval && (opts.allowance === undefined || opts.allowance < q.approval.amount) ? q.approval : undefined;
  if (q.amm) {
    const deadline = BigInt(Math.floor(opts.nowSec) + (opts.deadlineSec ?? 600));
    return { approval, txs: [buildAmmTx(q, { recipient: opts.recipient, deadline })] };
  }
  if (!q.txs?.length) throw new Error("This route has no transaction to sign");
  return { approval, txs: q.txs };
}

/** Warning levels for the UI. */
export function slippageWarning(slippageBps: number): "ok" | "high" | "extreme" {
  if (slippageBps > 1500) return "extreme";
  if (slippageBps > 300) return "high";
  return "ok";
}
