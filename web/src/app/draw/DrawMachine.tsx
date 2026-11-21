"use client";

import { zeroHash } from "viem";
import { useReadContracts, useWriteContract } from "wagmi";
import { towackLaunchAbi } from "@/abi";
import { BNB_TIERS, BONUS_TIERS, scaledCounts } from "@/components/PrizeTables";
import { ChainNote, DeployingSoon, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

const STEPS = [
  { key: "mint", label: "Mint open", desc: "Slots on sale" },
  { key: "vrf", label: "VRF requested", desc: "Waiting for Chainlink" },
  { key: "seed", label: "Seed in", desc: "Ready to finalize" },
  { key: "final", label: "Finalized", desc: "Claims open, trading live" },
] as const;

export function DrawMachine() {
  const { chainId, addresses, account, has } = useTowack();
  const launch = addresses.launch;
  const now = useNow();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const c = { address: launch, abi: towackLaunchAbi, chainId } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...c, functionName: "phase" },
      { ...c, functionName: "mintCount" },
      { ...c, functionName: "mintEnd" },
      { ...c, functionName: "vrfRequestId" },
      { ...c, functionName: "vrfRequestedAt" },
      { ...c, functionName: "seed" },
      { ...c, functionName: "claimDeadline" },
      { ...c, functionName: "bnbPrizeTotal" },
      { ...c, functionName: "bonusTotal" },
      { ...c, functionName: "lpBnb" },
      { ...c, functionName: "sentToDrawV2" },
      { ...c, functionName: "VRF_RETRY_DELAY" },
    ],
    query: { enabled: Boolean(launch), refetchInterval: 15_000 },
  });
  const r = (i: number) => data?.[i]?.result;
  const phase = r(0) as number | undefined;
  const mintCount = r(1) as bigint | undefined;
  const mintEnd = r(2) as bigint | undefined;
  const vrfRequestId = r(3) as bigint | undefined;
  const vrfRequestedAt = r(4) as bigint | undefined;
  const seed = r(5) as `0x${string}` | undefined;
  const claimDeadline = r(6) as bigint | undefined;
  const bnbPrizeTotal = r(7) as bigint | undefined;
  const bonusTotal = r(8) as bigint | undefined;
  const lpBnb = r(9) as bigint | undefined;
  const sentToDrawV2 = r(10) as bigint | undefined;
  const retryDelay = (r(11) as bigint | undefined) ?? 86400n;

  const { data: mine } = useReadContracts({
    contracts: [
      { ...c, functionName: "minterIndex", args: account ? [account] : undefined },
      { ...c, functionName: "claimed", args: account ? [account] : undefined },
      { ...c, functionName: "prizeOf", args: account ? [account] : undefined },
    ],
    query: { enabled: Boolean(launch && account), refetchInterval: 15_000 },
  });
  const minterIndex = mine?.[0]?.result as bigint | undefined;
  const claimed = mine?.[1]?.result as boolean | undefined;
  const prize = mine?.[2]?.result as readonly [bigint, bigint, bigint, bigint] | undefined;

  if (!has("launch")) {
    return (
      <DeployingSoon keys={["launch"]}>
        <StepRail active={-1} />
      </DeployingSoon>
    );
  }

  // Map on-chain phase to the four steps; Minting before close = step 0.
  const active = phase === undefined ? -1 : phase;
  const n = mintCount !== undefined ? Number(mintCount) : 0;
  const counts = scaledCounts(n);
  const isMinter = minterIndex !== undefined && minterIndex > 0n;
  const nowBig = BigInt(now);
  const canClose = phase === 0 && now > 0 && ((mintEnd !== undefined && nowBig >= mintEnd) || n >= 5000);
  const canRetry = phase === 1 && now > 0 && vrfRequestedAt !== undefined && nowBig >= vrfRequestedAt + retryDelay;
  const windowOpen = claimDeadline !== undefined && now > 0 && nowBig < claimDeadline;
  const hasPrize = prize ? prize[1] > 0n || prize[3] > 0n : false;

  const send = (label: string, fn: "closeMint" | "finalizeDraw" | "retryDraw" | "claim") =>
    tx.run(label, () => writeContractAsync({ address: launch!, abi: towackLaunchAbi, functionName: fn, chainId }));

  return (
    <div className="grid grid-cols-12 gap-8">
      <Panel className="col-span-12 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-extrabold">Machine status</h2>
          <ChainNote />
        </div>
        <div className="mt-6">
          <StepRail active={active} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Stat label="Minted" value={mintCount !== undefined ? n.toLocaleString("en-US") : "—"} sub="of 5,000" />
          <Stat
            label="VRF request"
            value={vrfRequestId && vrfRequestId > 0n ? `#${vrfRequestId.toString().slice(0, 8)}…` : "Not yet"}
            sub={vrfRequestedAt && vrfRequestedAt > 0n ? `sent ${fmtDate(vrfRequestedAt)}` : undefined}
          />
          <Stat label="Seed" value={seed && seed !== zeroHash ? `${seed.slice(0, 10)}…` : "Not in yet"} />
          <Stat
            label="Claim window"
            value={phase === 3 && claimDeadline ? (windowOpen ? `${fmtDuration(Number(claimDeadline) - now)} left` : "Closed") : "After finalize"}
            sub={phase === 3 && claimDeadline ? `until ${fmtDate(claimDeadline)}` : "180 days"}
          />
        </div>
        {phase === 3 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat label="BNB prizes" value={`${fmt18(bnbPrizeTotal, 3)} BNB`} />
            <Stat label="TWAK bonuses" value={fmt18(bonusTotal, 0)} />
            <Stat label="Listed with" value={`${fmt18(lpBnb, 2)} BNB`} sub={`${fmt18(sentToDrawV2, 2)} BNB to Draw V2`} />
          </div>
        ) : null}

        {canClose || phase === 2 || canRetry ? (
          <div className="mt-6 rounded-3xl border-[3px] border-dashed border-navy bg-ice p-5">
            <div className="font-display text-[20px] font-extrabold">Pull the lever</div>
            <p className="mt-1 font-semibold text-navy/70">These steps are permissionless — anyone can push the machine forward and pays only gas.</p>
            <NeedsWallet>
              <div className="mt-4 flex flex-wrap gap-3">
                {canClose ? (
                  <Button tone="sun" size="sm" disabled={tx.busy} onClick={() => send("Close mint", "closeMint")}>
                    Close mint + request VRF
                  </Button>
                ) : null}
                {canRetry ? (
                  <Button tone="white" size="sm" disabled={tx.busy} onClick={() => send("Retry VRF", "retryDraw")}>
                    Retry VRF request
                  </Button>
                ) : null}
                {phase === 2 ? (
                  <Button tone="sky" size="sm" disabled={tx.busy} onClick={() => send("Finalize draw", "finalizeDraw")}>
                    Finalize draw + list
                  </Button>
                ) : null}
              </div>
            </NeedsWallet>
          </div>
        ) : null}
        <TxNotice state={tx.state} onClose={tx.reset} />
      </Panel>

      <Panel className="col-span-12 lg:col-span-5" tone="navy">
        <h2 className="font-display text-[28px] font-extrabold text-sun">Your result</h2>
        <div className="mt-5 text-navy">
          <NeedsWallet why="Connect the wallet you minted with to see your slot.">
            {!isMinter ? (
              <div className="rounded-3xl bg-white p-6 font-bold">
                This wallet has no slot. {phase === 0 ? "The mint may still be open — head to the Mint page." : "Only minters take part in Draw V1."}
              </div>
            ) : phase !== 2 && phase !== 3 ? (
              <div className="rounded-3xl bg-white p-6">
                <Pill tone="sky">SLOT #{minterIndex?.toString()}</Pill>
                <p className="mt-3 font-bold">You&apos;re in. Results appear here once the VRF seed lands. No result is promised.</p>
              </div>
            ) : (
              <div className="rounded-3xl bg-white p-6">
                <div className="flex items-center justify-between">
                  <Pill tone="sky">SLOT #{minterIndex?.toString()}</Pill>
                  {claimed ? <Pill tone="sun">CLAIMED</Pill> : null}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <ResultStub
                    title="BNB prize"
                    value={prize && prize[1] > 0n ? `${fmt18(prize[1])} BNB` : "None"}
                    sub={prize && prize[0] < 4n ? BNB_TIERS[Number(prize[0])].tier : "NO TIER"}
                    win={Boolean(prize && prize[1] > 0n)}
                  />
                  <ResultStub
                    title="TWAK bonus"
                    value={prize && prize[3] > 0n ? `+${fmt18(prize[3], 0)}` : "None"}
                    sub={prize && prize[2] < 6n ? BONUS_TIERS[Number(prize[2])].mult : "NO BONUS"}
                    win={Boolean(prize && prize[3] > 0n)}
                  />
                </div>
                {phase === 2 ? (
                  <p className="mt-4 font-bold text-navy/70">Seed is in. Claims open after someone finalizes the draw.</p>
                ) : !hasPrize ? (
                  <p className="mt-4 font-bold text-navy/70">No prize on this slot this time. Your 80,000 TWAK from the mint is already yours.</p>
                ) : claimed ? (
                  <p className="mt-4 font-bold text-navy/70">Claimed. Check your wallet balance.</p>
                ) : !windowOpen ? (
                  <p className="mt-4 font-bold text-navy/70">The 180-day claim window has closed.</p>
                ) : (
                  <Button tone="candy" className="mt-5 w-full" disabled={tx.busy} onClick={() => send("Claim", "claim")}>
                    {tx.busy ? "Check your wallet…" : "Claim prize"}
                  </Button>
                )}
              </div>
            )}
          </NeedsWallet>
        </div>
      </Panel>

      {mintCount !== undefined && n > 0 && n < 5000 ? (
        <Panel className="col-span-12" tone="sunPale" shadow={false}>
          <h3 className="font-display text-[22px] font-extrabold">Scaled tables for {n.toLocaleString("en-US")} mints</h3>
          <div className="mt-3 flex flex-wrap gap-2 font-black">
            {BNB_TIERS.map((t, i) => (
              <span key={t.tier} className="rounded-full border-[3px] border-navy bg-white px-3 py-1">
                {t.tier}: {counts.bnb[i]}
              </span>
            ))}
            <span className="rounded-full border-[3px] border-navy bg-ice px-3 py-1">No BNB: {counts.bnb[4]}</span>
            {BONUS_TIERS.map((b, i) => (
              <span key={b.mult} className="rounded-full border-[3px] border-navy bg-candy-pale px-3 py-1">
                {b.mult}: {counts.bonus[i]}
              </span>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ResultStub({ title, value, sub, win }: { title: string; value: string; sub: string; win: boolean }) {
  return (
    <div className={`stub rounded-3xl p-4 text-center ${win ? "bg-sun" : "bg-ice text-navy/70"}`}>
      <div className="text-[12px] font-black uppercase tracking-widest">{title}</div>
      <div className="mt-1 font-display text-[24px] font-extrabold leading-tight">{value}</div>
      <div className="mt-2 border-t-2 border-dashed border-navy/30 pt-2 text-[12px] font-black tracking-widest">{sub}</div>
    </div>
  );
}

function StepRail({ active }: { active: number }) {
  return (
    <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {STEPS.map((s, i) => {
        const done = i < active;
        const on = i === active;
        return (
          <li
            key={s.key}
            className={`rounded-3xl border-[3px] border-navy p-4 text-left ${on ? "bg-candy text-white shadow-[0_6px_0_#13204A]" : done ? "bg-sky" : "bg-white text-navy/60"}`}
            aria-current={on ? "step" : undefined}
          >
            <div className="flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-full border-[3px] border-navy font-display font-extrabold ${on ? "bg-sun text-navy" : "bg-white text-navy"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className="font-display text-[16px] font-extrabold">{s.label}</span>
            </div>
            <div className="mt-1 text-sm font-bold opacity-80">{s.desc}</div>
          </li>
        );
      })}
    </ol>
  );
}
