/**
 * Spot swap + bridge quote library. Generic: knows nothing about Towack contracts, perps or React.
 * Providers: PancakeSwap v2/v3 + Uniswap v3 (on-chain, keyless), Relay (HTTP, keyless), 0x + 1inch (HTTP, key-gated).
 */
import { pancakeV2, pancakeV3, uniswapV3 } from "./amm";
import { oneInchProvider, zeroExProvider } from "./aggregators";
import { relayProvider } from "./relay";
import type { Provider } from "./types";

export * from "./types";
export * from "./tokens";
export * from "./amm";
export * from "./relay";
export * from "./aggregators";
export * from "./best";

export type ProviderKeys = { relayApiKey?: string; zeroExApiKey?: string; oneInchApiKey?: string; oneInchApiUrl?: string };

export function defaultProviders(keys: ProviderKeys = {}): Provider[] {
  return [
    pancakeV3,
    uniswapV3,
    pancakeV2,
    relayProvider({ apiKey: keys.relayApiKey }),
    zeroExProvider({ apiKey: keys.zeroExApiKey }),
    oneInchProvider({ apiKey: keys.oneInchApiKey, apiUrl: keys.oneInchApiUrl }),
  ];
}
