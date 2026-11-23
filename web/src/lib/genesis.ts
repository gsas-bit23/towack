"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { towackGenesisAbi } from "@/abi";
import { useTowack } from "@/lib/chain";

/** Standard ERC-721 views the Genesis gate needs (the registry is ERC-721; Enumerable is optional). */
export const agentNftAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "handleOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "string" }] },
  { type: "function", name: "ownerOfHandle", stateMutability: "view", inputs: [{ name: "handle", type: "string" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Contract-wide Genesis state (flat 20,000 TWAK gas-only claim: no VRF, no wheel). */
export function useGenesisState() {
  const { chainId, addresses } = useTowack();
  const genesis = addresses.genesis;
  const c = { address: genesis, abi: towackGenesisAbi, chainId } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...c, functionName: "isOpen" },
      { ...c, functionName: "mintCount" },
      { ...c, functionName: "MAX_MINTS" },
      { ...c, functionName: "agentId" },
      { ...c, functionName: "committed" },
    ],
    query: { enabled: Boolean(genesis), refetchInterval: 10_000 },
  });
  const r = <T,>(i: number) => data?.[i]?.result as T | undefined;
  return {
    genesis,
    isOpen: r<boolean>(0),
    mintCount: r<bigint>(1),
    cap: r<bigint>(2) ?? 300n,
    registry: r<`0x${string}`>(3),
    committed: r<bigint>(4),
    refetch,
  };
}

/** The connected wallet's Genesis claim: whether it claimed and its 1-based claim number. */
export function useMyGenesis() {
  const { chainId, addresses, account } = useTowack();
  const genesis = addresses.genesis;
  const enabled = Boolean(genesis && account);
  const minted = useReadContract({
    address: genesis,
    abi: towackGenesisAbi,
    functionName: "hasMinted",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });
  const index = useReadContract({
    address: genesis,
    abi: towackGenesisAbi,
    functionName: "mintIndexOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: enabled && minted.data === true, retry: false },
  });
  return {
    minted: minted.data,
    mintIndex: index.data !== undefined && index.data > 0n ? Number(index.data) : undefined,
    refetch: () => {
      void minted.refetch();
      void index.refetch();
    },
  };
}
