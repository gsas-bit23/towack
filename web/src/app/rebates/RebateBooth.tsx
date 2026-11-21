"use client";

import { useMemo, useState } from "react";
import { useReadContracts, useWriteContract } from "wagmi";
import { rebateDistributorAbi } from "@/abi";
import { ChainNote, NeedsContracts, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

const MAX_EPOCHS_SHOWN = 120;

export function RebateBooth() {
  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 lg:col-span-8">
        <NeedsContracts keys={["rebateDistributor"]}>
          <EpochTable />
        </NeedsContracts>
      </div>
      <div className="col-span-12 lg:col-span-4">
        <Panel tone="candyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">How rebates work</h2>
          <ul className="mt-3 space-y-2 font-bold text-navy/80">
            <li>★ Every swap through the Towack router pays 1% on the BNB leg.</li>
            <li>★ Half of that fee goes into this week&apos;s BNB rebate pot.</li>
            <li>★ The week&apos;s TWAK budget (~961,538 TWAK) is added on top.</li>
            <li>★ At the end of the week, your share = your fees ÷ all fees.</li>
            <li>★ Weeks with no trades roll their budget into the next week.</li>
            <li>★ Claim any finished week, any time, on-chain.</li>
          </ul>
          <p className="mt-4 text-sm font-semibold text-navy/70">
            Holding TWAK earns nothing here. Rebates return only part of the fees you paid plus a share of a fixed budget, and other traders dilute it.
            Not a yield product.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function EpochTable() {
  const { chainId, addresses, account } = useTowack();
  const dist = addresses.rebateDistributor!;
  const now = useNow();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const c = { address: dist, abi: rebateDistributorAbi, chainId } as const;
  const { data: meta } = useReadContracts({
    contracts: [
      { ...c, functionName: "currentEpoch" },
      { ...c, functionName: "finalizedEpochs" },
      { ...c, functionName: "startTime" },
      { ...c, functionName: "EPOCH_LENGTH" },
      { ...c, functionName: "carryTokens" },
      { ...c, functionName: "carryBnb" },
    ],
    query: { refetchInterval: 30_000 },
  });
  const current = meta?.[0]?.result as bigint | undefined;
  const finalized = meta?.[1]?.result as bigint | undefined;
  const start = meta?.[2]?.result as bigint | undefined;
  const epochLen = (meta?.[3]?.result as bigint | undefined) ?? 604800n;

  const curN = current !== undefined ? Number(current) : undefined;
  const finN = finalized !== undefined ? Number(finalized) : 0;
  const epochs = useMemo(() => {
    if (curN === undefined) return [] as number[];
    const lo = Math.max(0, curN - MAX_EPOCHS_SHOWN + 1);
    const list: number[] = [];
    for (let e = curN; e >= lo; e--) list.push(e);
    return list;
  }, [curN]);

  const { data: rows } = useReadContracts({
    contracts: epochs.flatMap((e) => [
      { ...c, functionName: "claimable", args: account ? [account, BigInt(e)] : undefined },
      { ...c, functionName: "claimed", args: account ? [BigInt(e), account] : undefined },
      { ...c, functionName: "feesOf", args: account ? [BigInt(e), account] : undefined },
      { ...c, functionName: "totalFees", args: [BigInt(e)] },
    ]),
    query: { enabled: Boolean(account && epochs.length), refetchInterval: 30_000 },
  });

  const table = epochs.map((e, i) => {
    const cl = rows?.[i * 4]?.result as readonly [bigint, bigint] | undefined;
    return {
      e,
      tokens: cl?.[0] ?? 0n,
      bnb: cl?.[1] ?? 0n,
      claimed: rows?.[i * 4 + 1]?.result as boolean | undefined,
      myFees: (rows?.[i * 4 + 2]?.result as bigint | undefined) ?? 0n,
      total: (rows?.[i * 4 + 3]?.result as bigint | undefined) ?? 0n,
      finalized: e < finN,
      live: e === curN,
    };
  });
  const visible = table.filter((r) => r.live || r.myFees > 0n || r.tokens > 0n || r.bnb > 0n);
  const claimableRows = table.filter((r) => r.finalized && !r.claimed && (r.tokens > 0n || r.bnb > 0n));
  const pendingCheckpoint = curN !== undefined && finN < curN;
  const sel = claimableRows.filter((r) => selected.has(r.e));
  const sumT = sel.reduce((a, r) => a + r.tokens, 0n);
  const sumB = sel.reduce((a, r) => a + r.bnb, 0n);
  const nextEnd = start !== undefined && current !== undefined ? Number(start + (current + 1n) * epochLen) : undefined;

  const toggle = (e: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });

  async function claim() {
    const list = sel.map((r) => BigInt(r.e));
    if (!list.length) return;
    const ok = await tx.run("Claim rebates", () =>
      writeContractAsync({ address: dist, abi: rebateDistributorAbi, functionName: "claim", args: [list], chainId }),
    );
    if (ok) setSelected(new Set());
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-extrabold">Epochs</h2>
        <ChainNote />
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Current epoch" value={curN !== undefined ? `#${curN}` : "—"} sub={nextEnd && now ? `ends in ${fmtDuration(nextEnd - now)}` : undefined} />
        <Stat label="Finalized up to" value={finalized !== undefined ? (finN > 0 ? `#${finN - 1}` : "none yet") : "—"} />
        <Stat label="Started" value={start ? fmtDate(start).split(",")[0] : "—"} sub="epoch 0" />
      </div>
      {pendingCheckpoint ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
          <span>Some finished weeks haven&apos;t been tallied yet. Anyone can run the checkpoint (gas only); claiming also runs it.</span>
          {account ? (
            <Button
              tone="white"
              size="sm"
              disabled={tx.busy}
              onClick={() => tx.run("Checkpoint", () => writeContractAsync({ address: dist, abi: rebateDistributorAbi, functionName: "checkpoint", chainId }))}
            >
              Run checkpoint
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6">
        <NeedsWallet why="Connect to see the fees you paid and the rebates you can claim.">
          {visible.length === 0 ? (
            <p className="rounded-2xl bg-ice px-4 py-6 text-center font-bold">No trading activity found for this wallet yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-y-2 text-left font-bold">
                <thead className="text-[12px] uppercase tracking-widest text-navy/60">
                  <tr>
                    <th className="px-3">Pick</th>
                    <th className="px-3">Epoch</th>
                    <th className="px-3">Your fees</th>
                    <th className="px-3">Share</th>
                    <th className="px-3">Claimable</th>
                    <th className="px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const can = claimableRows.includes(r);
                    const share = r.total > 0n ? Number((r.myFees * 10000n) / r.total) / 100 : 0;
                    return (
                      <tr key={r.e} className="bg-ice">
                        <td className="rounded-l-2xl px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-[#FF4FA3]"
                            disabled={!can}
                            checked={selected.has(r.e)}
                            onChange={() => toggle(r.e)}
                            aria-label={`Select epoch ${r.e}`}
                          />
                        </td>
                        <td className="px-3 py-3 font-display font-extrabold">#{r.e}</td>
                        <td className="px-3 py-3">{fmt18(r.myFees, 6)} BNB</td>
                        <td className="px-3 py-3">{share.toFixed(2)}%</td>
                        <td className="px-3 py-3">
                          {r.finalized ? (
                            <>
                              {fmt18(r.tokens, 2)} TWAK
                              <br />
                              <span className="text-sm text-navy/60">+ {fmt18(r.bnb, 6)} BNB</span>
                            </>
                          ) : (
                            <span className="text-navy/50">after week ends</span>
                          )}
                        </td>
                        <td className="rounded-r-2xl px-3 py-3">
                          {r.live ? <Pill tone="sky">LIVE</Pill> : r.claimed ? <Pill tone="ice">CLAIMED</Pill> : r.finalized ? can ? <Pill tone="sun">READY</Pill> : <Pill tone="ice">—</Pill> : <Pill tone="white">TALLYING</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl border-[3px] border-navy bg-white p-4">
            <div className="font-bold">
              Selected: <span className="font-display font-extrabold">{fmt18(sumT, 2)} TWAK</span> + <span className="font-display font-extrabold">{fmt18(sumB, 6)} BNB</span>
            </div>
            <div className="flex gap-3">
              <Button tone="white" size="sm" disabled={!claimableRows.length} onClick={() => setSelected(new Set(claimableRows.map((r) => r.e)))}>
                Select all
              </Button>
              <Button tone="candy" size="sm" disabled={!sel.length || tx.busy} onClick={claim}>
                {tx.busy ? "Check your wallet…" : `Claim ${sel.length || ""} epoch${sel.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
          <TxNotice state={tx.state} onClose={tx.reset} />
        </NeedsWallet>
      </div>
    </Panel>
  );
}
