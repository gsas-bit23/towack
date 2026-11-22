"use client";

import { useEffect, useState } from "react";
import { useReadContract, useReadContracts, useWatchContractEvent } from "wagmi";
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

export type MyGenesis = { minted: boolean; assigned: boolean; prizeId: number; extra: bigint; claimed: boolean };

/** Contract-wide Genesis state. */
export function useGenesisState() {
  const { chainId, addresses } = useTowack();
  const genesis = addresses.genesis;
  const c = { address: genesis, abi: towackGenesisAbi, chainId } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...c, functionName: "isOpen" },
      { ...c, functionName: "mintCount" },
      { ...c, functionName: "MAX_MINTS" },
      { ...c, functionName: "agentId" },
      { ...c, functionName: "remainingCounts" },
      { ...c, functionName: "committed" },
      { ...c, functionName: "VRF_RETRY_DELAY" },
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
    remaining: r<readonly bigint[]>(4)?.map(Number),
    committed: r<bigint>(5),
    retryDelay: Number(r<bigint>(6) ?? 3600n),
  };
}

/** The connected wallet's Genesis ticket; polls fast while VRF is pending and listens for PrizeAssigned. */
export function useMyGenesis() {
  const { chainId, addresses, account } = useTowack();
  const genesis = addresses.genesis;
  const enabled = Boolean(genesis && account);
  const q = useReadContract({
    address: genesis,
    abi: towackGenesisAbi,
    functionName: "prizeOf",
    args: account ? [account] : undefined,
    chainId,
    query: {
      enabled,
      refetchInterval: (query) => {
        const d = query.state.data;
        return d && d[0] && !d[1] ? 4_000 : 15_000;
      },
    },
  });
  const { data: ticket } = useReadContract({
    address: genesis,
    abi: towackGenesisAbi,
    functionName: "tickets",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });
  useWatchContractEvent({
    address: genesis,
    abi: towackGenesisAbi,
    eventName: "PrizeAssigned",
    args: account ? { minter: account } : undefined,
    chainId,
    enabled,
    onLogs: () => void q.refetch(),
  });
  const d = q.data;
  const prize: MyGenesis | undefined = d ? { minted: d[0], assigned: d[1], prizeId: Number(d[2]), extra: d[3], claimed: d[4] } : undefined;
  return {
    prize,
    mintIndex: ticket ? Number(ticket[0]) : undefined,
    requestedAt: ticket ? Number(ticket[4]) : undefined,
  };
}

/**
 * Non-production Genesis wheel demo (`?demo=genesis`). Same gate as the paid demo: allowed only when no
 * Genesis contract is configured or NEXT_PUBLIC_DEMO_WHEEL=1. Always labelled as a demo.
 */
export function useGenesisDemo() {
  const { addresses } = useTowack();
  const allowed = !addresses.genesis || process.env.NEXT_PUBLIC_DEMO_WHEEL === "1";
  const [fromUrl, setFromUrl] = useState(false);
  useEffect(() => {
    const read = () => setFromUrl(new URLSearchParams(window.location.search).get("demo") === "genesis");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return { allowed, active: allowed && fromUrl };
}
