import { bsc } from "viem/chains";

/**
 * Production is locked to BNB Smart Chain mainnet (chain 56). The chain-97 entries in addresses.json are kept as
 * historical data only and are never read at runtime. NEXT_PUBLIC_DEFAULT_CHAIN_ID is intentionally ignored so a
 * stale env value (e.g. 97) cannot move the site off mainnet.
 */
export const APP_CHAIN_ID = 56 as const;
export type AppChainId = typeof APP_CHAIN_ID;

export const DEFAULT_CHAIN_ID: AppChainId = APP_CHAIN_ID;

export const APP_CHAIN = bsc;
export const RPC_URL = "https://bsc-dataseed.bnbchain.org";

export const CHAIN_META = { name: "BNB Smart Chain", short: "BNB Chain", explorer: "https://bscscan.com" } as const;

export function isAppChain(id: number | undefined): id is AppChainId {
  return id === APP_CHAIN_ID;
}
