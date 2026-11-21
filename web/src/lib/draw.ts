"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient, useReadContract, useReadContracts, useWatchContractEvent } from "wagmi";
import { towackLaunchAbi } from "@/abi";
import { useTowack } from "@/lib/chain";

export const LAUNCH_PHASES = ["Minting", "Closed", "Listed"] as const;

export type MyPrize = {
  minted: boolean;
  assigned: boolean;
  prizeId: number;
  bnb: bigint;
  bonus: bigint;
  claimed: boolean;
};

/**
 * The connected wallet's Draw V1 ticket. Polls fast while a VRF answer is pending and also listens for
 * PrizeAssigned(minter = you) so the wheel can land as soon as the callback is mined.
 */
export function useMyPrize() {
  const { chainId, addresses, account } = useTowack();
  const launch = addresses.launch;
  const enabled = Boolean(launch && account);
  const q = useReadContract({
    address: launch,
    abi: towackLaunchAbi,
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
    address: launch,
    abi: towackLaunchAbi,
    functionName: "tickets",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });
  useWatchContractEvent({
    address: launch,
    abi: towackLaunchAbi,
    eventName: "PrizeAssigned",
    args: account ? { minter: account } : undefined,
    chainId,
    enabled,
    onLogs: () => void q.refetch(),
  });

  const d = q.data;
  const prize: MyPrize | undefined = d
    ? { minted: d[0], assigned: d[1], prizeId: Number(d[2]), bnb: d[3], bonus: d[4], claimed: d[5] }
    : undefined;
  return {
    prize,
    mintIndex: ticket ? Number(ticket[0]) : undefined,
    requestedAt: ticket ? Number(ticket[4]) : undefined,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/** Launch-wide state for the prize booth. `legacy` = this address does not speak the per-mint deck ABI. */
export function useLaunchState() {
  const { chainId, addresses } = useTowack();
  const launch = addresses.launch;
  const c = { address: launch, abi: towackLaunchAbi, chainId } as const;
  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...c, functionName: "phase" },
      { ...c, functionName: "mintCount" },
      { ...c, functionName: "MAX_MINTS" },
      { ...c, functionName: "mintStart" },
      { ...c, functionName: "mintEnd" },
      { ...c, functionName: "remainingCounts" },
      { ...c, functionName: "remainingTotal" },
      { ...c, functionName: "assignedCount" },
      { ...c, functionName: "bnbAssigned" },
      { ...c, functionName: "bonusAssigned" },
      { ...c, functionName: "bnbOutstanding" },
      { ...c, functionName: "claimDeadline" },
      { ...c, functionName: "lpBnb" },
      { ...c, functionName: "sentToDrawV2" },
      { ...c, functionName: "bonusBurned" },
      { ...c, functionName: "VRF_RETRY_DELAY" },
    ],
    query: { enabled: Boolean(launch), refetchInterval: 10_000 },
  });
  const r = <T,>(i: number) => data?.[i]?.result as T | undefined;
  const legacy = Boolean(launch) && !isLoading && data !== undefined && data[6]?.status === "failure";
  return {
    launch: launch as Address | undefined,
    legacy,
    phase: r<number>(0),
    mintCount: r<bigint>(1),
    cap: r<bigint>(2) ?? 5000n,
    mintStart: r<bigint>(3),
    mintEnd: r<bigint>(4),
    remaining: r<readonly bigint[]>(5)?.map(Number),
    remainingTotal: r<bigint>(6),
    assignedCount: r<bigint>(7),
    bnbAssigned: r<bigint>(8),
    bonusAssigned: r<bigint>(9),
    bnbOutstanding: r<bigint>(10),
    claimDeadline: r<bigint>(11),
    lpBnb: r<bigint>(12),
    sentToDrawV2: r<bigint>(13),
    bonusBurned: r<bigint>(14),
    retryDelay: Number(r<bigint>(15) ?? 3600n),
  };
}

export type Spin = { key: string; minter: Address; prizeId: number; mintIndex: number; time?: number; demo?: boolean };

const LOOKBACK_BLOCKS = 4_000n;
const FEED_MAX = 14;

/** Recent PrizeAssigned events: a short log backfill, then live via the event watcher. */
export function useRecentSpins(enabled = true) {
  const { chainId, addresses } = useTowack();
  const launch = addresses.launch;
  const client = usePublicClient({ chainId });
  const [spins, setSpins] = useState<Spin[]>([]);
  const on = Boolean(enabled && launch && client);

  useEffect(() => {
    if (!on || !client || !launch) return;
    let stop = false;
    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const logs = await client.getContractEvents({
          address: launch,
          abi: towackLaunchAbi,
          eventName: "PrizeAssigned",
          fromBlock: latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n,
          toBlock: latest,
        });
        const last = logs.slice(-FEED_MAX);
        const blocks = [...new Set(last.map((l) => l.blockNumber))];
        const times = new Map<bigint, number>();
        await Promise.all(
          blocks.map(async (b) => {
            try {
              const blk = await client.getBlock({ blockNumber: b });
              times.set(b, Number(blk.timestamp));
            } catch {
              /* time is optional */
            }
          }),
        );
        if (stop) return;
        const rows: Spin[] = last
          .filter((l) => l.args.minter !== undefined)
          .map((l) => ({
            key: `${l.transactionHash}-${l.logIndex}`,
            minter: l.args.minter as Address,
            prizeId: Number(l.args.prizeId ?? 10),
            mintIndex: Number(l.args.mintIndex ?? 0n),
            time: times.get(l.blockNumber),
          }))
          .reverse();
        setSpins((cur) => merge(cur, rows)); // anything already live is newer
      } catch {
        /* RPC without log support / range limits: the live watcher still fills the feed */
      }
    })();
    return () => {
      stop = true;
    };
  }, [on, client, launch]);

  useWatchContractEvent({
    address: launch,
    abi: towackLaunchAbi,
    eventName: "PrizeAssigned",
    chainId,
    enabled: on,
    onLogs: (logs) => {
      const now = Math.floor(Date.now() / 1000);
      const rows: Spin[] = logs
        .filter((l) => l.args.minter !== undefined)
        .map((l) => ({
          key: `${l.transactionHash}-${l.logIndex}`,
          minter: l.args.minter as Address,
          prizeId: Number(l.args.prizeId ?? 10),
          mintIndex: Number(l.args.mintIndex ?? 0n),
          time: now,
        }))
        .reverse();
      setSpins((cur) => merge(rows, cur));
    },
  });

  return spins;
}

/** Newest-first merge, de-duplicated by log key. */
function merge(newer: Spin[], older: Spin[]): Spin[] {
  const seen = new Set<string>();
  const out: Spin[] = [];
  for (const s of [...newer, ...older]) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push(s);
  }
  return out.slice(0, FEED_MAX);
}

/**
 * Non-production demo of the wheel (`?demo=wheel`). Only allowed when no live per-mint launch contract is
 * configured (missing or legacy address) or NEXT_PUBLIC_DEMO_WHEEL=1. Always labelled as a demo.
 */
export function useDemoWheel(legacy: boolean) {
  const { addresses } = useTowack();
  const allowed = !addresses.launch || legacy || process.env.NEXT_PUBLIC_DEMO_WHEEL === "1";
  const [fromUrl, setFromUrl] = useState(false);
  useEffect(() => {
    const read = () => setFromUrl(new URLSearchParams(window.location.search).get("demo") === "wheel");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return { allowed, active: allowed && fromUrl };
}

/** Sample rows for the demo feed only (never shown next to a live contract). */
export const DEMO_SPINS: Spin[] = [
  { key: "d1", minter: "0x5a17000000000000000000000000000000c0ffee", prizeId: 3, mintIndex: 5, demo: true },
  { key: "d2", minter: "0x9b2200000000000000000000000000000000beef", prizeId: 7, mintIndex: 4, demo: true },
  { key: "d3", minter: "0x13f3000000000000000000000000000000001234", prizeId: 10, mintIndex: 3, demo: true },
  { key: "d4", minter: "0xd84800000000000000000000000000000000abcd", prizeId: 0, mintIndex: 2, demo: true },
  { key: "d5", minter: "0x7fa9000000000000000000000000000000004242", prizeId: 2, mintIndex: 1, demo: true },
];
