"use client";

import { useQuery } from "@tanstack/react-query";
import { signedRequest, type StoredAgent } from "@/lib/aster/client";
import { parseDualSide, parseMaxLeverage, parsePositionRows, parseUsdtBalance } from "@/lib/aster/orders";

/** USDT margin (`GET /fapi/v3/balance`), shared by the account card and the ticket's % sizing. */
export function useAsterBalance(agent: StoredAgent | undefined) {
  return useQuery({
    queryKey: ["aster-balance", agent?.net, agent?.signer],
    queryFn: async () => parseUsdtBalance(await signedRequest(agent!, "GET", "/fapi/v3/balance")),
    enabled: Boolean(agent),
    refetchInterval: 30_000,
    retry: false,
  });
}

/** Every `GET /fapi/v3/positionRisk` row (flat rows carry each symbol's leverage + margin type). */
export function usePositionRisk(agent: StoredAgent | undefined) {
  return useQuery({
    queryKey: ["aster-position-risk", agent?.net, agent?.signer],
    queryFn: async () => parsePositionRows(await signedRequest(agent!, "GET", "/fapi/v3/positionRisk")),
    enabled: Boolean(agent),
    refetchInterval: 10_000,
    retry: false,
  });
}

/** `GET /fapi/v3/positionSide/dual`: this terminal only sends one-way (BOTH) orders. */
export function useHedgeMode(agent: StoredAgent | undefined) {
  return useQuery({
    queryKey: ["aster-dual-side", agent?.net, agent?.signer],
    queryFn: async () => parseDualSide(await signedRequest(agent!, "GET", "/fapi/v3/positionSide/dual")),
    enabled: Boolean(agent),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Max leverage for a symbol from `GET /fapi/v3/leverageBrackets` (USER_DATA). Falls back to 125 when unknown. */
export function useMaxLeverage(agent: StoredAgent | undefined, symbol: string) {
  return useQuery({
    queryKey: ["aster-lev-brackets", agent?.net, agent?.signer, symbol],
    queryFn: async () => parseMaxLeverage(await signedRequest(agent!, "GET", "/fapi/v3/leverageBrackets", [["symbol", symbol]]), symbol) ?? null,
    enabled: Boolean(agent && symbol),
    staleTime: 10 * 60_000,
    retry: false,
  });
}
