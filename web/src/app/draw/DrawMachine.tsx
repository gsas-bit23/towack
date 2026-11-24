"use client";

import { useWriteContract } from "wagmi";
import { towackLaunchAbi } from "@/abi";
import { AnimatedNumber } from "@/components/motion";
import { DemoWheel, MyWheel } from "@/components/MyWheel";
import { PrizeLegend, SpinFeed, WheelStage } from "@/components/PrizeBooth";
import { DeployingSoon, LegacyLaunchNote, NeedsWallet, TxNotice } from "@/components/status";
import { Button, ButtonLink, Panel, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { DEMO_SPINS, useDemoWheel, useLaunchState, useMyPrize, useRecentSpins } from "@/lib/draw";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useLocale, type MessageKey } from "@/lib/i18n";

const STEPS: { label: MessageKey; desc: MessageKey }[] = [
  { label: "draw.step1", desc: "draw.step1d" },
  { label: "draw.step2", desc: "draw.step2d" },
  { label: "draw.step3", desc: "draw.step3d" },
];

export function DrawMachine() {
  const { chainId, has, account } = useTowack();
  const s = useLaunchState();
  const { prize } = useMyPrize();
  const demo = useDemoWheel(s.legacy);
  const spins = useRecentSpins(!s.legacy);
  const now = useNow();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const { t } = useLocale();
  const demoLink = (
    <>
      {t("common.previewOnly")}{" "}
      <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=wheel">
        {t("common.playDemo")}
      </a>{" "}
      {t("common.demoNote")}
    </>
  );

  if (!has("launch") && !demo.active) {
    return (
      <div className="space-y-8">
        <DeployingSoon keys={["launch"]}>
          <StepRail active={-1} />
          {demo.allowed ? (
            <p className="mt-4 text-sm font-medium text-muted">{demoLink}</p>
          ) : null}
        </DeployingSoon>
        <Panel>
          <h2 className="font-display text-[28px] font-semibold">{t("draw.deckTitle")}</h2>
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
          <h2 className="font-display text-[28px] font-semibold">{isMinter ? t("draw.yourSpin") : t("draw.wheel")}</h2>
        </div>
        {s.legacy ? <LegacyLaunchNote /> : null}
        <div className="mt-6">
          {demo.active ? (
            <DemoWheel size={460} />
          ) : !account ? (
            <>
              <WheelStage status="none" size={460} />
              <NeedsWallet why={t("draw.connectWhy")}>{null}</NeedsWallet>
            </>
          ) : isMinter && !s.legacy ? (
            <MyWheel retryDelay={s.retryDelay} size={460} />
          ) : (
            <WheelStage
              status="none"
              size={460}
              idleNote={
                <>
                  {t("draw.noSpin")}{" "}
                  {phase === 0 ? (
                    <ButtonLink href="/mint" size="sm" className="ml-2 mt-2">
                      {t("draw.mintToSpin")}
                    </ButtonLink>
                  ) : (
                    t("draw.onlyMinters")
                  )}
                </>
              }
            />
          )}
        </div>
        {demo.allowed && !demo.active ? (
          <p className="mt-2 text-center text-xs font-medium text-muted">{demoLink}</p>
        ) : null}
      </Panel>

      {/* Live feed */}
      <Panel className="col-span-12 lg:col-span-5" tone="raised">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[28px] font-semibold text-gold">{t("draw.recent")}</h2>
          <span className="flex items-center gap-2 text-xs font-semibold text-sub">
            <span className=" h-2.5 w-2.5 rounded-full bg-gold/10" /> {t("common.live")}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-sub">{t("draw.everyPrize")}</p>
        <div className="mt-4 text-fg">
          <SpinFeed spins={demo.active ? DEMO_SPINS : spins} />
        </div>
      </Panel>

      {/* Machine status */}
      <Panel className="col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[28px] font-semibold">{t("draw.status")}</h2>
        </div>
        <div className="mt-6">
          <StepRail active={phase ?? -1} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("draw.minted")} value={<AnimatedNumber value={s.mintCount !== undefined ? n : undefined} />} sub={t("draw.of5000")} />
          <Stat
            label={t("draw.vrf")}
            value={pending === undefined ? "—" : pending === 0 ? t("draw.allLanded") : t("draw.waiting", { n: pending })}
            sub={s.assignedCount !== undefined ? t("draw.assigned", { n: Number(s.assignedCount).toLocaleString("en-US") }) : undefined}
          />
          <Stat label={t("draw.deckLeft")} value={s.remainingTotal !== undefined ? Number(s.remainingTotal).toLocaleString("en-US") : "—"} sub={t("draw.slotsOf")} />
          <Stat
            label={t("draw.claimWindow")}
            value={listed && s.claimDeadline ? (windowOpen ? t("draw.left", { d: fmtDuration(Number(s.claimDeadline) - now) }) : t("draw.closed")) : t("draw.openNow")}
            sub={listed && s.claimDeadline ? t("draw.until", { date: fmtDate(s.claimDeadline) }) : t("draw.after180")}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label={t("draw.bnbAssigned")} value={`${fmt18(s.bnbAssigned, 3)} BNB`} sub={t("draw.escrow", { n: fmt18(s.bnbOutstanding, 3) })} />
          <Stat label={t("draw.twakAssigned")} value={fmt18(s.bonusAssigned, 0)} sub={t("draw.fromReserve")} />
          {listed ? (
            <Stat label={t("draw.listedWith")} value={`${fmt18(s.lpBnb, 2)} BNB`} sub={t("draw.listedSub", { a: fmt18(s.sentToDrawV2, 2), b: fmt18(s.bonusBurned, 0) })} />
          ) : (
            <Stat label={t("draw.listing")} value={t("draw.afterClose")} sub={t("draw.listingSub")} />
          )}
        </div>

        {canClose || canFinalize ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line bg-card-2 p-5">
            <div className="font-display text-[20px] font-semibold">{t("draw.lever")}</div>
            <p className="mt-1 font-semibold text-sub">{t("draw.leverBody")}</p>
            <NeedsWallet>
              <div className="mt-4 flex flex-wrap gap-3">
                {canClose ? (
                  <Button tone="soft" size="sm" disabled={tx.busy} onClick={() => send(t("draw.closeMint"), "closeMint")}>
                    {t("draw.closeMint")}
                  </Button>
                ) : null}
                {canFinalize ? (
                  <Button tone="soft" size="sm" disabled={tx.busy} onClick={() => send(t("draw.finalize"), "finalizeListing")}>
                    {t("draw.finalize")}
                  </Button>
                ) : null}
              </div>
            </NeedsWallet>
          </div>
        ) : phase === 1 && pending !== undefined && pending > 0 ? (
          <p className="mt-6 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
            {t("draw.pendingNote", { n: pending })}
          </p>
        ) : null}
        <TxNotice state={tx.state} onClose={tx.reset} />
      </Panel>

      {/* Deck legend */}
      <Panel className="col-span-12" tone="gold" shadow={false}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[28px] font-semibold">{t("draw.deckTitle")}</h2>
          <span className="text-sm font-semibold text-muted">{t("draw.trueOdds")}</span>
        </div>
        <div className="mt-5">
          <PrizeLegend remaining={s.remaining} />
        </div>
      </Panel>
    </div>
  );
}

function StepRail({ active }: { active: number }) {
  const { t } = useLocale();
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
              <span className="font-display text-[16px] font-semibold">{t(st.label)}</span>
            </div>
            <div className="mt-1 text-sm font-medium opacity-80">{t(st.desc)}</div>
          </li>
        );
      })}
    </ol>
  );
}
