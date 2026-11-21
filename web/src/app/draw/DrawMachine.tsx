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
            <p className="mt-4 text-sm font-bold text-navy/60">
              Preview only: <a className="underline" href="?demo=wheel">play a demo spin</a> (no transaction, not a real prize).
            </p>
          ) : null}
        </DeployingSoon>
        <Panel>
          <h2 className="font-display text-[28px] font-extrabold">The 5,000-slot deck</h2>
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
    <div className="grid grid-cols-12 gap-8">
      {/* Wheel */}
      <Panel className="relative col-span-12 overflow-hidden lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-extrabold">{isMinter ? "Your spin" : "The wheel"}</h2>
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
          <p className="mt-2 text-center text-xs font-bold text-navy/50">
            Preview only: <a className="underline" href="?demo=wheel">play a demo spin</a> (no transaction, not a real prize).
          </p>
        ) : null}
      </Panel>

      {/* Live feed */}
      <Panel className="col-span-12 lg:col-span-5" tone="navy">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[28px] font-extrabold text-sun">Recent spins</h2>
          <span className="flex items-center gap-2 text-xs font-black text-white/70">
            <span className="bulb h-2.5 w-2.5 rounded-full bg-candy" /> LIVE
          </span>
        </div>
        <p className="mt-1 text-sm font-bold text-white/70">Every PrizeAssigned event from the launch contract, as it lands.</p>
        <div className="mt-4 text-navy">
          <SpinFeed spins={demo.active ? DEMO_SPINS : spins} />
        </div>
      </Panel>

      {/* Machine status */}
      <Panel className="col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-extrabold">Booth status</h2>
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
          <div className="mt-6 rounded-3xl border-[3px] border-dashed border-navy bg-ice p-5">
            <div className="font-display text-[20px] font-extrabold">Pull the lever</div>
            <p className="mt-1 font-semibold text-navy/70">These steps are permissionless — anyone can push the machine forward and pays only gas.</p>
            <NeedsWallet>
              <div className="mt-4 flex flex-wrap gap-3">
                {canClose ? (
                  <Button tone="sun" size="sm" disabled={tx.busy} onClick={() => send("Close mint", "closeMint")}>
                    Close mint
                  </Button>
                ) : null}
                {canFinalize ? (
                  <Button tone="sky" size="sm" disabled={tx.busy} onClick={() => send("Finalize listing", "finalizeListing")}>
                    Finalize listing
                  </Button>
                ) : null}
              </div>
            </NeedsWallet>
          </div>
        ) : phase === 1 && pending !== undefined && pending > 0 ? (
          <p className="mt-6 rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
            Mint closed. Listing unlocks when the last {pending} VRF spin{pending === 1 ? "" : "s"} land.
          </p>
        ) : null}
        <TxNotice state={tx.state} onClose={tx.reset} />
      </Panel>

      {/* Deck legend */}
      <Panel className="col-span-12" tone="sunPale" shadow={false}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[28px] font-extrabold">The 5,000-slot deck</h2>
          <span className="text-sm font-black text-navy/60">true odds per mint at the start · live remaining counts</span>
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
            className={`rounded-3xl border-[3px] border-navy p-4 text-left transition-colors ${on ? "bg-candy text-white shadow-[0_6px_0_#13204A]" : done ? "bg-sky" : "bg-white text-navy/60"}`}
            aria-current={on ? "step" : undefined}
          >
            <div className="flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-full border-[3px] border-navy font-display font-extrabold ${on ? "bg-sun text-navy" : "bg-white text-navy"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className="font-display text-[16px] font-extrabold">{st.label}</span>
            </div>
            <div className="mt-1 text-sm font-bold opacity-80">{st.desc}</div>
          </li>
        );
      })}
    </ol>
  );
}
