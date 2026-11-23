"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useGasPrice, usePublicClient } from "wagmi";
import type { AppChainId } from "@/config/chains";
import {
  defaultProviders,
  getBestRoutes,
  isNativeLike,
  NATIVE,
  ORIGIN_TOKENS,
  pancakeV2,
  scoreQuotes,
  type FetchLike,
  type QuoteRequest,
  type Reader,
  type RouteResult,
  type Token,
} from "@/lib/quotes";

/** Quotes need *some* sender before a wallet is connected. Relay builds calldata for it, so those quotes are preview-only. */
export const PREVIEW_USER: Address = "0x000000000000000000000000000000000000dEaD";

const KEYS = {
  relayApiKey: process.env.NEXT_PUBLIC_RELAY_API_KEY?.trim() || undefined,
  zeroExApiKey: process.env.NEXT_PUBLIC_ZEROX_API_KEY?.trim() || undefined,
  oneInchApiKey: process.env.NEXT_PUBLIC_ONEINCH_API_KEY?.trim() || undefined,
  oneInchApiUrl: process.env.NEXT_PUBLIC_ONEINCH_API_URL?.trim() || undefined,
};
export const PROVIDER_KEYS_SET = { zeroex: Boolean(KEYS.zeroExApiKey), oneinch: Boolean(KEYS.oneInchApiKey) };
const PROVIDERS = defaultProviders(KEYS);
const browserFetch: FetchLike = (url, init) => fetch(url, init);

export function useDebounced<T>(value: T, ms = 450): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type RoutesArgs = {
  chainId: AppChainId;
  tokenIn: Token;
  tokenOut: Token;
  amountIn?: bigint;
  slippageBps?: number;
  account?: Address;
  recipient?: Address;
  paused: boolean;
};

/** Fetches + ranks every provider's quote (see lib/quotes/best.ts for the scoring). Refreshes every 20 s. */
export function useRoutes(a: RoutesArgs) {
  const client = usePublicClient({ chainId: a.chainId });
  const { data: gasPrice } = useGasPrice({ chainId: a.chainId, query: { refetchInterval: 30_000 } });
  const user = a.account ?? PREVIEW_USER;
  const enabled = Boolean(client && a.amountIn && a.amountIn > 0n && a.slippageBps !== undefined && !a.paused);

  const key = useMemo(
    () => ["swap-routes", a.chainId, a.tokenIn.chainId, a.tokenIn.address, a.tokenOut.chainId, a.tokenOut.address, a.amountIn?.toString(), a.slippageBps, user, a.recipient ?? ""],
    [a.chainId, a.tokenIn, a.tokenOut, a.amountIn, a.slippageBps, user, a.recipient],
  );

  const q = useQuery<RouteResult & { quotedFor: Address; at: number }>({
    queryKey: key,
    enabled,
    refetchInterval: a.paused ? false : 20_000,
    staleTime: 15_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const reader = client as unknown as Reader;
      const req: QuoteRequest = {
        tokenIn: a.tokenIn,
        tokenOut: a.tokenOut,
        amountIn: a.amountIn!,
        slippageBps: a.slippageBps!,
        user,
        recipient: a.recipient,
        gasPriceWei: gasPrice,
      };
      const ctx = { reader, fetch: browserFetch, signal };
      // Gas → output-token reference for token → token swaps (1 BNB through PancakeSwap v2). Optional.
      const sameChain = a.tokenIn.chainId === a.tokenOut.chainId;
      const needsRef = sameChain && !isNativeLike(a.tokenIn) && !isNativeLike(a.tokenOut);
      const native = ORIGIN_TOKENS[a.chainId]?.find((t) => t.address === NATIVE);
      const ref =
        needsRef && native
          ? pancakeV2
              .quote({ ...req, tokenIn: native, amountIn: 10n ** 18n }, ctx)
              .then((r) => r.amountOut)
              .catch(() => undefined)
          : Promise.resolve(undefined);
      const [nativeToOut, r] = await Promise.all([ref, getBestRoutes(req, PROVIDERS, ctx)]);
      const quotes = nativeToOut ? scoreQuotes(r.quotes, req, { nativeToOut }) : r.quotes;
      return { ...r, quotes, best: quotes[0], quotedFor: user, at: Date.now() };
    },
  });
  return { ...q, enabled, gasPrice };
}
