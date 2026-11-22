import { encodeFunctionData, type Abi, type Address } from "viem";
import { isNative, VENUES } from "./tokens";
import {
  applySlippage,
  DEFAULT_GAS_PRICE_WEI,
  PROVIDER_LABEL,
  type AmmPlan,
  type Hex,
  type Provider,
  type ProviderCtx,
  type Quote,
  type QuoteRequest,
  type Token,
  type TxRequest,
} from "./types";

/**
 * On-chain AMM adapters: PancakeSwap v2, PancakeSwap v3 and Uniswap v3 on BNB Chain. Keyless: quotes are eth_calls
 * through the user's normal public RPC. Swaps go straight to the official routers, signed in the user's wallet.
 */

export const V2_ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

// QuoterV2 is technically non-view (it reverts internally) but is meant to be eth_call'ed; typed as view for readContract.
export const V3_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** IV3SwapRouter (Uniswap SwapRouter02 and PancakeSwap SmartRouter share it: no deadline in the struct). */
export const V3_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

/** Router constant: "this router" as recipient (output is then unwrapped to native and sent on). */
export const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";

/** Rough gas for scoring (BSC). v3 uses the quoter's own estimate plus router overhead. */
export const GAS = { v2Base: 110_000n, v2PerHop: 60_000n, v3Overhead: 70_000n, unwrap: 30_000n, approve: 46_000n };

const fmtFee = (fee: number) => `${(fee / 10_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}% pool`;

function pathToken(t: Token, wrapped: Address): Address {
  return isNative(t) ? wrapped : t.address;
}

function baseQuote(req: QuoteRequest, provider: Quote["provider"], amountOut: bigint, gasUnits: bigint, route: string, amm: AmmPlan): Quote {
  const gasPrice = req.gasPriceWei ?? DEFAULT_GAS_PRICE_WEI;
  return {
    provider,
    label: PROVIDER_LABEL[provider],
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut,
    minAmountOut: applySlippage(amountOut, req.slippageBps),
    gasUnits,
    gasCostWei: gasUnits * gasPrice,
    route,
    crossChain: false,
    approval: isNative(req.tokenIn) ? undefined : { token: req.tokenIn.address, spender: amm.router, amount: req.amountIn },
    amm,
  };
}

function sameChainOnly(req: QuoteRequest) {
  return req.tokenIn.chainId === req.tokenOut.chainId && req.amountIn > 0n && req.tokenIn.address.toLowerCase() !== req.tokenOut.address.toLowerCase();
}

function wrapPair(req: QuoteRequest, wrapped: Address) {
  const a = pathToken(req.tokenIn, wrapped);
  const b = pathToken(req.tokenOut, wrapped);
  return { a, b, same: a.toLowerCase() === b.toLowerCase() };
}

export const pancakeV2: Provider = {
  id: "pancakeV2",
  supports: (req) => sameChainOnly(req) && Boolean(VENUES[req.tokenIn.chainId]?.pancakeV2),
  async quote(req, ctx) {
    const v = VENUES[req.tokenIn.chainId];
    if (!v?.pancakeV2 || !ctx.reader) throw new Error("PancakeSwap v2 is not available on this chain");
    const { a, b, same } = wrapPair(req, v.wrappedNative);
    if (same) throw new Error("Wrap / unwrap is not a swap");
    const w = v.wrappedNative;
    const paths: Address[][] = [[a, b]];
    if (a.toLowerCase() !== w.toLowerCase() && b.toLowerCase() !== w.toLowerCase()) paths.push([a, w, b]);
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        const amounts = (await ctx.reader!.readContract({
          address: v.pancakeV2!.router,
          abi: V2_ROUTER_ABI as unknown as Abi,
          functionName: "getAmountsOut",
          args: [req.amountIn, path],
        })) as readonly bigint[];
        return { path, out: amounts[amounts.length - 1] ?? 0n };
      }),
    );
    let best: { path: Address[]; out: bigint } | undefined;
    for (const r of results) if (r.status === "fulfilled" && r.value.out > 0n && (!best || r.value.out > best.out)) best = r.value;
    if (!best) throw new Error("No PancakeSwap v2 liquidity for this pair");
    const hops = BigInt(best.path.length - 1);
    const gas = GAS.v2Base + GAS.v2PerHop * (hops - 1n);
    const route = best.path.length === 3 ? `${req.tokenIn.symbol} → WBNB → ${req.tokenOut.symbol}` : `${req.tokenIn.symbol} → ${req.tokenOut.symbol}`;
    return baseQuote(req, "pancakeV2", best.out, gas, route, {
      kind: "v2",
      router: v.pancakeV2.router,
      path: best.path,
      nativeIn: isNative(req.tokenIn),
      nativeOut: isNative(req.tokenOut),
    });
  },
};

function v3Provider(id: "pancakeV3" | "uniswapV3"): Provider {
  const venue = (chainId: number) => (id === "pancakeV3" ? VENUES[chainId]?.pancakeV3 : VENUES[chainId]?.uniswapV3);
  return {
    id,
    supports: (req) => sameChainOnly(req) && Boolean(venue(req.tokenIn.chainId)),
    async quote(req: QuoteRequest, ctx: ProviderCtx) {
      const v = VENUES[req.tokenIn.chainId];
      const cfg = venue(req.tokenIn.chainId);
      if (!v || !cfg || !ctx.reader) throw new Error(`${PROVIDER_LABEL[id]} is not available on this chain`);
      const { a, b, same } = wrapPair(req, v.wrappedNative);
      if (same) throw new Error("Wrap / unwrap is not a swap");
      const results = await Promise.allSettled(
        cfg.fees.map(async (fee) => {
          const r = (await ctx.reader!.readContract({
            address: cfg.quoter,
            abi: V3_QUOTER_ABI as unknown as Abi,
            functionName: "quoteExactInputSingle",
            args: [{ tokenIn: a, tokenOut: b, amountIn: req.amountIn, fee, sqrtPriceLimitX96: 0n }],
          })) as readonly [bigint, bigint, number, bigint];
          return { fee, out: r[0], gas: r[3] };
        }),
      );
      let best: { fee: number; out: bigint; gas: bigint } | undefined;
      for (const r of results) if (r.status === "fulfilled" && r.value.out > 0n && (!best || r.value.out > best.out)) best = r.value;
      if (!best) throw new Error(`No ${PROVIDER_LABEL[id]} pool for this pair`);
      const nativeOut = isNative(req.tokenOut);
      const gas = best.gas + GAS.v3Overhead + (nativeOut ? GAS.unwrap : 0n);
      return baseQuote(req, id, best.out, gas, `${req.tokenIn.symbol} → ${req.tokenOut.symbol} · ${fmtFee(best.fee)}`, {
        kind: "v3",
        router: cfg.router,
        tokenIn: a,
        tokenOut: b,
        fee: best.fee,
        nativeIn: isNative(req.tokenIn),
        nativeOut,
      });
    },
  };
}

export const pancakeV3 = v3Provider("pancakeV3");
export const uniswapV3 = v3Provider("uniswapV3");

/**
 * Router calldata for an AMM quote, built at execute time so the deadline is fresh. Exact-input only; the recipient is
 * the signer's own wallet unless told otherwise. Pure function: easy to test and to re-derive in the BAW instructions.
 */
export function buildAmmTx(q: Quote, opts: { recipient: Address; deadline: bigint }): TxRequest {
  const plan = q.amm;
  if (!plan) throw new Error("Not an AMM route");
  const chainId = q.tokenIn.chainId;
  const value = plan.nativeIn ? q.amountIn : 0n;
  let data: Hex;
  if (plan.kind === "v2") {
    if (plan.nativeIn) {
      data = encodeFunctionData({ abi: V2_ROUTER_ABI, functionName: "swapExactETHForTokens", args: [q.minAmountOut, plan.path, opts.recipient, opts.deadline] });
    } else if (plan.nativeOut) {
      data = encodeFunctionData({
        abi: V2_ROUTER_ABI,
        functionName: "swapExactTokensForETH",
        args: [q.amountIn, q.minAmountOut, plan.path, opts.recipient, opts.deadline],
      });
    } else {
      data = encodeFunctionData({
        abi: V2_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [q.amountIn, q.minAmountOut, plan.path, opts.recipient, opts.deadline],
      });
    }
  } else {
    const swap = encodeFunctionData({
      abi: V3_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: plan.tokenIn,
          tokenOut: plan.tokenOut,
          fee: plan.fee,
          recipient: plan.nativeOut ? ADDRESS_THIS : opts.recipient,
          amountIn: q.amountIn,
          amountOutMinimum: q.minAmountOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const calls: Hex[] = [swap];
    if (plan.nativeOut) calls.push(encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "unwrapWETH9", args: [q.minAmountOut, opts.recipient] }));
    // multicall(deadline, ...) gives the v3 call the same deadline protection as the v2 router.
    data = encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "multicall", args: [opts.deadline, calls] });
  }
  return { chainId, to: plan.router, data, value, gas: q.gasUnits };
}
