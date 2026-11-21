import { bsc, bscTestnet } from "viem/chains";
import type { SupportedChainId } from "./addresses";

export const RPC_URLS: Record<SupportedChainId, string> = {
  97: "https://bsc-testnet-rpc.publicnode.com",
  56: "https://bsc-dataseed.bnbchain.org",
};

export const CHAINS = [bscTestnet, bsc] as const;

export const CHAIN_META: Record<SupportedChainId, { name: string; short: string; explorer: string; testnet: boolean }> = {
  97: { name: "BSC Testnet", short: "Testnet", explorer: "https://testnet.bscscan.com", testnet: true },
  56: { name: "BNB Smart Chain", short: "Mainnet", explorer: "https://bscscan.com", testnet: false },
};

export function isSupportedChain(id: number | undefined): id is SupportedChainId {
  return id === 97 || id === 56;
}

const envDefault = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID ?? "97");
export const DEFAULT_CHAIN_ID: SupportedChainId = isSupportedChain(envDefault) ? envDefault : 97;
