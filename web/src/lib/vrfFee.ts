"use client";

import type { Address } from "viem";
import { useGasPrice, useReadContract } from "wagmi";
import { fmt18 } from "@/lib/format";
import type { SupportedChainId } from "@/config/addresses";

/** `vrfFeeAt(uint256 gasPrice)`: identical on TowackLaunch, TowackGenesis and DrawV2 (VRFConsumerV25). */
const vrfFeeAbi = [
  {
    type: "function",
    name: "vrfFeeAt",
    stateMutability: "view",
    inputs: [{ name: "gasPrice", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Chainlink VRF fee the user pays on every randomness request (mint / Genesis mint / pool entry / retry).
 * Paid in BNB per request to the official Chainlink VRF v2.5 direct-funding WRAPPER (no subscription).
 * Quoted on-chain with OUR contract's `vrfFeeAt(gasPrice)` = the wrapper's `estimateRequestPriceNative` at that gas
 * price + 10% (never `vrfFee()` / the wrapper's `calculateRequestPriceNative`: both use tx.gasprice, which is often
 * 0 in eth_call). On-chain the contract charges the wrapper's price at the tx's REAL gas price, forwards exactly
 * that (the wrapper itself never refunds overpayment) and refunds everything else to the sender in the same tx.
 * UI cushions on top, also refunded by our contract: quote at +25% of the current gas price (the wallet may bump
 * it), then send +10%. Together with the contract's 10% they cover a ~1.5x gas-price move; beyond that the tx
 * reverts with VrfFeeTooLow (nothing is taken).
 *
 * `supported === false` means the contract predates user-paid fees (older retired testnet deploys only; the live
 * testnet stack and the mainnet script are all wrapper-based and user-paid): send no fee.
 */
export function useVrfFee(address: Address | undefined, chainId: SupportedChainId) {
  const { data: gasPrice } = useGasPrice({ chainId, query: { refetchInterval: 15_000 } });
  const quoteGas = gasPrice !== undefined ? (gasPrice * 125n) / 100n : undefined;
  const { data, isError } = useReadContract({
    address,
    abi: vrfFeeAbi,
    functionName: "vrfFeeAt",
    args: quoteGas !== undefined ? [quoteGas] : undefined,
    chainId,
    query: { enabled: Boolean(address) && quoteGas !== undefined, refetchInterval: 15_000, retry: false },
  });
  const supported: boolean | undefined = data !== undefined ? true : isError ? false : undefined;
  const fee = data ?? (supported === false ? 0n : undefined);
  const value = data !== undefined ? data + data / 10n : supported === false ? 0n : undefined;
  return { fee, value, supported, label: fee !== undefined ? `${fmtFee(fee)} BNB` : "…" };
}

/** Small-number BNB formatting for fees (fmt18 rounds tiny values to 0). */
export function fmtFee(wei: bigint): string {
  if (wei === 0n) return "0";
  const s = Number(wei) / 1e18;
  if (s >= 0.01) return fmt18(wei);
  return s.toPrecision(2);
}
