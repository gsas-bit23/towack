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
 * Quoted on-chain with `vrfFeeAt(gasPrice)` (never `vrfFee()`: eth_call often has tx.gasprice = 0). Two small UI
 * cushions, both refunded by the contract in the same tx: quote at +25% of the current gas price (the wallet may
 * bump it), then send +10%.
 *
 * `supported === false` means the contract predates user-paid fees (the current testnet deploy): send no fee.
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
