"use client";

import { useWriteContract } from "wagmi";
import { towackLaunchAbi } from "@/abi";
import { AnimatedNumber } from "@/components/motion";
import { DemoWheel, MyWheel } from "@/components/MyWheel";
import { PrizeLegend, SpinFeed, WheelStage } from "@/components/PrizeBooth";
import { ChainNote, DeployingSoon, LegacyLaunchNote, NeedsWallet, TxNotice } from "@/components/status";
import { Button, ButtonLink, Panel, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { DEMO_SPINS, useDemoWheel, useLaunchState, useMyPrize, useRecentSpins } from "@/lib/draw";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

const STEPS = [
  { label: "Mint + spin", desc: "Each mint draws its own prize" },
  { label: "Mint closed", desc: "Last spins landing" },
  { label: "Listed", desc: "LP seeded, trading live" },
] as const;

export function DrawMachine() {
  const { chainId, has, account } = useTowack();
  const s = useLaunchState();
  const { prize } = useMyPrize();
  const demo = useDemoWheel(s.legacy);
  const spins = useRecentSpins(!s.legacy);
  const now = useNow();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  if (!has("launch") && !demo.active) {
    return (
      <div className="space-y-8">
        <DeployingSoon keys={["launch"]}>
          <StepRail active={-1} />
          {demo.allowed ? (
            <p className="mt-4 text-sm font-medium text-muted">
              Preview only: <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=wheel">play a demo spin</a> (no transaction, not a real prize).
            </p>
          ) : null}
        </DeployingSoon>
        <Panel>
          <h2 className="font-display text-[28px] font-semibold">The 5,000-slot deck</h2>
          <div className="mt-5">
            <PrizeLegend />
          </div>
        </Panel>
      </div>
    );
  }

  const phase = s.phase;
  const n = s.mintCount !== undefined ? Number(s.mintCount) : 0;
  const pending = s.mintCount !== undefined && s.assignedCount !== undefined ? Number(s.mintCount - s.assignedCount) : undefined;
  const nowBig = BigInt(now);
  const canClose = phase === 0 && now > 0 && ((s.mintEnd !== undefined && nowBig >= s.mintEnd) || n >= 5000);
  const canFinalize = phase === 1 && pending === 0;
  const listed = phase === 2;
  const windowOpen = listed && s.claimDeadline !== undefined && now > 0 && nowBig < s.claimDeadline;
  const isMinter = Boolean(prize?.minted);

  const send = (label: string, fn: "closeMint" | "finalizeListing") =>
    tx.run(label, () => writeContractAsync({ address: s.launch!, abi: towackLaunchAbi, functionName: fn, chainId }));

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      {/* Wheel */}
      <Panel className="relative col-span-12 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-semibold">{isMinter ? "Your spin" : "The wheel"}</h2>
          <ChainNote />
        </div>
        {s.legacy ? <LegacyLaunchNote /> : null}
        <div className="mt-6">
          {demo.active ? (
            <DemoWheel size={460} />
          ) : !account ? (
            <>
              <WheelStage status="none" size={460} />
              <NeedsWallet why="Connect the wallet you minted with to see your spin.">{null}</NeedsWallet>
            </>
          ) : isMinter && !s.legacy ? (
            <MyWheel retryDelay={s.retryDelay} size={460} />
          ) : (
            <WheelStage
              status="none"
              size={460}
              idleNote={
                <>
                  This wallet has no spin yet.{" "}
                  {phase === 0 ? (
                    <ButtonLink href="/mint" size="sm" className="ml-2 mt-2">
                      Mint to spin →
                    </ButtonLink>
                  ) : (
                    "Only minters take part in Draw V1."
                  )}
                </>
              }
            />
          )}
        </div>
        {demo.allowed && !demo.active ? (
          <p className="mt-2 text-center text-xs font-medium text-muted">
            Preview only: <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=wheel">play a demo spin</a> (no transaction, not a real prize).
          </p>
        ) : null}
      </Panel>

      {/* Live feed */}
      <Panel className="col-span-12 lg:col-span-5" tone="raised">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[28px] font-semibold text-gold">Recent spins</h2>
          <span className="flex items-center gap-2 text-xs font-semibold text-sub">
            <span className=" h-2.5 w-2.5 rounded-full bg-gold/10" /> LIVE
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-sub">Every PrizeAssigned event from the launch contract, as it lands.</p>
        <div className="mt-4 text-fg">
          <SpinFeed spins={demo.active ? DEMO_SPINS : spins} />
        </div>
      </Panel>

      {/* Machine status */}
      <Panel className="col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-semibold">Booth status</h2>
        </div>
        <div className="mt-6">
          <StepRail active={phase ?? -1} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Minted" value={<AnimatedNumber value={s.mintCount !== undefined ? n : undefined} />} sub="of 5,000" />
          <Stat
            label="VRF"
            value={pending === undefined ? "—" : pending === 0 ? "All landed" : `${pending} waiting`}
            sub={s.assignedCount !== undefined ? `${Number(s.assignedCount).toLocaleString("en-US")} prizes assigned` : undefined}
          />
          <Stat label="Deck left" value={s.remainingTotal !== undefined ? Number(s.remainingTotal).toLocaleString("en-US") : "—"} sub="slots of 5,000" />
          <Stat
            label="Claim window"
            value={listed && s.claimDeadline ? (windowOpen ? `${fmtDuration(Number(s.claimDeadline) - now)} left` : "Closed") : "Open now"}
            sub={listed && s.claimDeadline ? `until ${fmtDate(s.claimDeadline)}` : "180 days after listing"}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="BNB prizes assigned" value={`${fmt18(s.bnbAssigned, 3)} BNB`} sub={`${fmt18(s.bnbOutstanding, 3)} BNB still in escrow`} />
          <Stat label="TWAK bonuses assigned" value={fmt18(s.bonusAssigned, 0)} sub="from the 50M reserve" />
          {listed ? (
            <Stat label="Listed with" value={`${fmt18(s.lpBnb, 2)} BNB`} sub={`${fmt18(s.sentToDrawV2, 2)} BNB to Draw V2 · ${fmt18(s.bonusBurned, 0)} bonus burned`} />
          ) : (
            <Stat label="Listing" value="After close" sub="at the mint price, 800k TWAK / BNB" />
          )}
        </div>

        {canClose || canFinalize ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line bg-card-2 p-5">
            <div className="font-display text-[20px] font-semibold">Pull the lever</div>
            <p className="mt-1 font-semibold text-sub">These steps are permissionless — anyone can push the machine forward and pays only gas.</p>
            <NeedsWallet>
              <div className="mt-4 flex flex-wrap gap-3">
                {canClose ? (
                  <Button tone="soft" size="sm" disabled={tx.busy} onClick={() => send("Close mint", "closeMint")}>
                    Close mint
                  </Button>
                ) : null}
                {canFinalize ? (
                  <Button tone="soft" size="sm" disabled={tx.busy} onClick={() => send("Finalize listing", "finalizeListing")}>
                    Finalize listing
                  </Button>
                ) : null}
              </div>
            </NeedsWallet>
          </div>
        ) : phase === 1 && pending !== undefined && pending > 0 ? (
          <p className="mt-6 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
            Mint closed. Listing unlocks when the last {pending} VRF spin{pending === 1 ? "" : "s"} land.
          </p>
        ) : null}
        <TxNotice state={tx.state} onClose={tx.reset} />
      </Panel>

      {/* Deck legend */}
      <Panel className="col-span-12" tone="gold" shadow={false}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[28px] font-semibold">The 5,000-slot deck</h2>
          <span className="text-sm font-semibold text-muted">true odds per mint at the start · live remaining counts</span>
        </div>
        <div className="mt-5">
          <PrizeLegend remaining={s.remaining} />
        </div>
      </Panel>
    </div>
  );
}

function StepRail({ active }: { active: number }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {STEPS.map((st, i) => {
        const done = i < active;
        const on = i === active;
        return (
          <li
            key={st.label}
            className={`rounded-2xl border border-line p-4 text-left transition-colors ${on ? "bg-gold/10 text-fg" : done ? "bg-card-2" : "bg-card text-muted"}`}
            aria-current={on ? "step" : undefined}
          >
            <div className="flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-full border border-line font-display font-semibold ${on ? "bg-gold/15 text-fg" : "bg-card text-fg"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className="font-display text-[16px] font-semibold">{st.label}</span>
            </div>
            <div className="mt-1 text-sm font-medium opacity-80">{st.desc}</div>
          </li>
        );
      })}
    </ol>
  );
}
