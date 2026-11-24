"use client";

import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { formatEther, parseEther, zeroAddress } from "viem";
import { useReadContract, useReadContracts, useWatchContractEvent, useWriteContract } from "wagmi";
import { drawV2Abi, towackTokenAbi } from "@/abi";
import { AnimatedNumber, Confetti, Skeleton, SuccessCheck } from "@/components/motion";
import { ShareButton, useWheelMachine, type WheelStatus } from "@/components/PrizeBooth";
import { SpinWheel } from "@/components/SpinWheel";
import { AgentPathToggle } from "@/components/AgentPath";
import { RiskLine } from "@/components/RiskNote";
import { AddressLink, NeedsWallet, RpcErrorNotice, TxNotice, VrfSource } from "@/components/status";
import { Button, Panel, Pill, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDuration } from "@/lib/format";
import {
  POOL_EV_PCT,
  POOL_INTENDED_SEED,
  POOL_MAX_ENTRY_PCT,
  POOL_MAX_PAYOUT_PCT,
  POOL_MIN_ENTRY,
  POOL_NO_WIN_ID,
  POOL_PRIZES,
  POOL_SLICES,
  POOL_SPLIT,
  oddsPct,
  payoutFor,
  poolPrizeById,
} from "@/lib/poolPrizes";
import { useLocale } from "@/lib/i18n";
import { poolLabel, poolShareText } from "@/lib/prizeText";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useVrfFee } from "@/lib/vrfFee";

const WHEEL_SIZE = 400;
const E18 = 10n ** 18n;
const MIN_WEI = BigInt(POOL_MIN_ENTRY) * E18;
const DEMO_ENTRY = 1_000n * E18;

type SpinTuple = readonly [`0x${string}`, number, number, bigint, bigint, bigint, bigint, bigint];

// ---------------------------------------------------------------- wheel stage

function PoolWheelStage({
  status,
  prizeId,
  entry,
  bnb,
  salt = 0,
  fresh = false,
  demo = false,
  waitingNote,
  actions,
  idleNote,
}: {
  status: WheelStatus;
  prizeId?: number;
  entry?: bigint;
  bnb?: bigint;
  salt?: number;
  fresh?: boolean;
  demo?: boolean;
  waitingNote?: ReactNode;
  actions?: ReactNode;
  idleNote?: ReactNode;
}) {
  const { mode, landed, burst, onLanded } = useWheelMachine(status, fresh, prizeId, POOL_NO_WIN_ID);
  const { t } = useLocale();
  const prize = poolPrizeById(prizeId);
  const showResult = landed && prize !== undefined && status === "assigned";
  const paid = prize && entry !== undefined ? payoutFor(entry, prize) : undefined;
  const vsEntry = prize ? (prize.multBps < 10_000 ? t("lot.less") : prize.multBps === 10_000 ? t("lot.even") : t("lot.more")) : "";

  return (
    <div className="relative">
      {demo ? (
        <div className="mb-4 flex justify-center">
          <Pill tone="gold" className="border border-line text-[13px]">
            {t("lot.demoPill")}
          </Pill>
        </div>
      ) : null}
      <div className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 overflow-hidden rounded-2xl" aria-hidden="true">
        <Confetti fire={burst} big={Boolean(prize?.jackpot)} />
      </div>
      <SpinWheel mode={mode} prizeId={prizeId} salt={salt} onLanded={onLanded} size={WHEEL_SIZE} prizes={POOL_PRIZES} slices={POOL_SLICES} />

      <div className="mt-6 min-h-[110px]" aria-live="polite">
        {status === "waiting" || (status === "assigned" && !landed) ? (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-[18px] font-semibold sm:text-[20px]">
              <span className="blink h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
              {status === "waiting" ? t("lot.waitingVrf") : t("wheel.hereItComes")}
            </div>
            {waitingNote ? <div className="mt-2 text-[14px] text-sub">{waitingNote}</div> : null}
          </div>
        ) : showResult ? (
          <motion.div
            initial={{ y: 12, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className={`rounded-2xl border px-5 py-5 text-center ${prize.multBps === 0 ? "border-line bg-card-2" : prize.jackpot ? "gold-hairline border-gold/40 bg-gold/[.06]" : "border-line-2 bg-card-2"}`}
          >
            {prize.multBps > 0 && !demo ? <SuccessCheck className="mx-auto mb-2 h-9 w-9" /> : null}
            <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">{demo ? t("wheel.demoLanded") : t("wheel.says")}</div>
            <div className={`mt-1 text-[26px] font-semibold leading-tight tracking-tight sm:text-[28px] ${prize.jackpot ? "text-gold" : ""}`}>{poolLabel(t, prize)}</div>
            {paid !== undefined && entry !== undefined ? (
              <>
                <div className="mt-1 text-[18px] font-semibold">
                  {prize.multBps === 0 ? t("lot.zeroPaid") : `${fmt18(paid, 2)} TWAK`}
                  {bnb && bnb > 0n ? t("lot.bnbBonus", { n: fmt18(bnb, 5) }) : ""}
                </div>
                <div className="mt-1 text-sm font-medium text-muted">
                  {t("lot.fromEntry", { n: fmt18(entry, 2) })}
                  {prize.multBps === 0 ? "." : ` — ${vsEntry}.`}
                </div>
              </>
            ) : null}
            {actions ? <div className="mt-4 flex flex-wrap justify-center gap-3">{actions}</div> : null}
          </motion.div>
        ) : (
          <div className="text-center font-medium text-sub">{idleNote}</div>
        )}
      </div>
    </div>
  );
}

const DEMO_PRIZES = [3, 0, 1, 6, 2, 4];

function DemoWheel() {
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState<WheelStatus>("waiting");
  const { t } = useLocale();
  useEffect(() => {
    const id = setTimeout(() => setStatus("assigned"), 2800);
    return () => clearTimeout(id);
  }, [round]);
  const prizeId = DEMO_PRIZES[(round - 1) % DEMO_PRIZES.length];
  return (
    <PoolWheelStage
      key={round}
      status={status}
      prizeId={prizeId}
      entry={DEMO_ENTRY}
      salt={round}
      fresh
      demo
      waitingNote={t("wheel.demoOnly")}
      actions={
        <Button
          tone="line"
          size="sm"
          className="min-h-11"
          onClick={() => {
            setStatus("waiting");
            setRound((r) => r + 1);
          }}
        >
          {t("wheel.demoAgain")}
        </Button>
      }
    />
  );
}

/** `?demo=pool`: allowed only when no Draw V2 pool is configured or NEXT_PUBLIC_DEMO_WHEEL=1. Always labelled. */
function usePoolDemo() {
  const { addresses } = useTowack();
  const allowed = !addresses.drawV2 || process.env.NEXT_PUBLIC_DEMO_WHEEL === "1";
  const [fromUrl, setFromUrl] = useState(false);
  useEffect(() => {
    const read = () => setFromUrl(new URLSearchParams(window.location.search).get("demo") === "pool");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return { allowed, active: allowed && fromUrl };
}

// ---------------------------------------------------------------- payout table

function PayoutTable({ entry }: { entry?: bigint }) {
  const e = entry && entry >= MIN_WEI ? entry : DEMO_ENTRY;
  const { t } = useLocale();
  return (
    <Panel tone="card" shadow={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[24px] font-semibold">{t("lot.payout")}</h2>
        <span className="text-sm font-semibold text-muted">{t("lot.payoutSub", { n: fmt18(e, 0) })}</span>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2" role="table" aria-label={t("lot.payoutAria")}>
        <div role="row" className="contents text-[11px] font-semibold uppercase tracking-[.15em] text-muted">
          <span role="columnheader">{t("lot.tier")}</span>
          <span role="columnheader">{t("lot.odds")}</span>
          <span role="columnheader" className="text-right">
            {t("lot.pays")}
          </span>
        </div>
        {POOL_PRIZES.map((p) => (
          <div role="row" key={p.id} className="contents">
            <span role="cell" className="grid h-10 min-w-[52px] place-items-center rounded-full border border-line px-2 font-display text-[14px] font-semibold" style={{ background: p.fill, color: p.ink }}>
              {p.wheel}
            </span>
            <span role="cell" className="min-w-0">
              <span className="block font-mono text-[15px] font-medium leading-tight">{oddsPct(p).toFixed(0)}%</span>
              <span className="block text-[12px] font-medium text-muted">
                {t("lot.slots", { n: p.slots.toLocaleString("en-US") })}
                {p.bnbBonusBps ? t("lot.upToPot", { p: p.bnbBonusBps / 100 }) : ""}
              </span>
            </span>
            <span role="cell" className="whitespace-nowrap text-right font-display text-[15px] font-semibold">
              {p.multBps === 0 ? "0" : fmt18(payoutFor(e, p), 0)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-gold/5 px-4 py-3">
        <div className="font-display text-[20px] font-semibold">{t("lot.ev", { p: POOL_EV_PCT })}</div>
        <p className="mt-1 text-sm font-medium text-sub">
          {t("lot.evBody", { less: POOL_SPLIT.less, even: POOL_SPLIT.even, more: POOL_SPLIT.more })}
        </p>
      </div>
    </Panel>
  );
}

function HowItWorks() {
  const { t } = useLocale();
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="font-display text-[24px] font-semibold">{t("lot.how")}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 font-medium text-sub">
        <li>{t("lot.how1")}</li>
        <li>{t("lot.how2")}</li>
        <li>{t("lot.how3", { min: POOL_MIN_ENTRY, maxPct: POOL_MAX_ENTRY_PCT, payPct: POOL_MAX_PAYOUT_PCT })}</li>
        <li>{t("lot.how4")}</li>
        <li>{t("lot.how5")}</li>
        <li>{t("lot.how6")}</li>
      </ol>
    </Panel>
  );
}

function TreasuryNote() {
  const { addresses } = useTowack();
  const { t } = useLocale();
  return (
    <Panel tone="raised" shadow={false}>
      <Pill tone="gold">{t("lot.poolPill")}</Pill>
      <p className="mt-3 font-medium text-sub">{t("lot.funded", { seed: POOL_INTENDED_SEED })}</p>
      {addresses.drawV2 ? (
        <p className="mt-3 break-all text-sm font-medium text-sub">
          {t("lot.contract")} <AddressLink address={addresses.drawV2} />
        </p>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------- live booth

function parseAmount(v: string): bigint | undefined {
  try {
    return v.trim() ? parseEther(v.trim() as `${number}`) : undefined;
  } catch {
    return undefined;
  }
}

function PoolStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card-2 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[.15em] text-muted">{label}</div>
      <div className="mt-0.5 break-words font-mono text-[19px] font-medium leading-tight tracking-tight sm:text-[22px]">{value}</div>
      {sub ? <div className="text-[12px] font-medium text-muted">{sub}</div> : null}
    </div>
  );
}

function LiveBooth({ amount, setAmount }: { amount: string; setAmount: (v: string) => void }) {
  const { chainId, addresses, account } = useTowack();
  const draw = addresses.drawV2!;
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const now = useNow(5_000);
  const { t } = useLocale();
  const [fresh, setFresh] = useState(false);
  // Every entry / retry is a VRF request: the player sends the Chainlink VRF fee in BNB (excess refunded).
  // Exactly the wrapper's price goes to the Chainlink VRF wrapper, never into the BNB pot.
  const vrf = useVrfFee(draw, chainId);

  const c = { address: draw, abi: drawV2Abi, chainId } as const;
  const { data, isError: poolErr, refetch } = useReadContracts({
    contracts: [
      { ...c, functionName: "availableTwak" },
      { ...c, functionName: "availableBnb" },
      { ...c, functionName: "maxEntry" },
      { ...c, functionName: "entriesPaused" },
      { ...c, functionName: "token" },
      { ...c, functionName: "bnbBonusPreview" },
      { ...c, functionName: "VRF_RETRY_DELAY" },
      { ...c, functionName: "spinCount" },
    ],
    query: { refetchInterval: 15_000 },
  });
  const r = <T,>(i: number) => data?.[i]?.result as T | undefined;
  const freeTwak = r<bigint>(0);
  const freeBnb = r<bigint>(1);
  const maxEntry = r<bigint>(2);
  const paused = r<boolean>(3);
  const boundToken = r<`0x${string}`>(4);
  const bonus = r<readonly [bigint, bigint]>(5);
  const retryDelay = Number(r<bigint>(6) ?? 3600n);
  const spinCount = r<bigint>(7);
  const token = boundToken && boundToken !== zeroAddress ? boundToken : addresses.token;
  const bound = boundToken ? boundToken !== zeroAddress : undefined;

  const { data: me, refetch: refetchMe } = useReadContracts({
    contracts: [
      { ...c, functionName: "lastSpinOf", args: account ? [account] : undefined },
      { ...c, functionName: "owedTwak", args: account ? [account] : undefined },
      { ...c, functionName: "owedBnb", args: account ? [account] : undefined },
      { address: token, abi: towackTokenAbi, functionName: "balanceOf", args: account ? [account] : undefined, chainId },
      { address: token, abi: towackTokenAbi, functionName: "allowance", args: account ? [account, draw] : undefined, chainId },
    ],
    query: { enabled: Boolean(account && token), refetchInterval: 15_000 },
  });
  const lastSpin = me?.[0]?.result as bigint | undefined;
  const owedTwak = (me?.[1]?.result as bigint | undefined) ?? 0n;
  const owedBnb = (me?.[2]?.result as bigint | undefined) ?? 0n;
  const myTwak = me?.[3]?.result as bigint | undefined;
  const allowance = me?.[4]?.result as bigint | undefined;

  const { data: spin, refetch: refetchSpin } = useReadContract({
    ...c,
    functionName: "spins",
    args: lastSpin ? [lastSpin] : undefined,
    query: {
      enabled: Boolean(lastSpin),
      refetchInterval: (q) => ((q.state.data as SpinTuple | undefined)?.[1] === 1 ? 4_000 : 20_000),
    },
  });
  const s = spin as SpinTuple | undefined;
  const { data: spinPrize } = useReadContract({
    ...c,
    functionName: "spinPrize",
    args: lastSpin ? [lastSpin] : undefined,
    query: { enabled: Boolean(lastSpin && s?.[1] === 2) },
  });

  useWatchContractEvent({
    ...c,
    eventName: "SpinAssigned",
    args: account ? { player: account } : undefined,
    enabled: Boolean(account),
    onLogs: () => {
      void refetchSpin();
      void refetchMe();
      void refetch();
    },
  });

  const status: WheelStatus = !s || s[1] === 0 ? "none" : s[1] === 1 ? "waiting" : "assigned";
  const requestedAt = s ? Number(s[3]) : undefined;
  const canRetry = status === "waiting" && now > 0 && requestedAt !== undefined && now >= requestedAt + retryDelay;

  const amountIn = parseAmount(amount);
  const poolOpen = maxEntry !== undefined ? maxEntry >= MIN_WEI : undefined;
  const tooSmall = amountIn !== undefined && amountIn < MIN_WEI;
  const tooBig = amountIn !== undefined && maxEntry !== undefined && amountIn > maxEntry;
  const tooMuch = amountIn !== undefined && myTwak !== undefined && amountIn > myTwak;
  const needsApproval = amountIn !== undefined && (allowance ?? 0n) < amountIn;
  const canEnter = Boolean(account && bound && !paused && poolOpen && amountIn && !tooSmall && !tooBig && !tooMuch && status !== "waiting" && vrf.value !== undefined);
  const hasOwed = owedTwak > 0n || owedBnb > 0n;

  async function enter() {
    if (!canEnter || !amountIn || !token || vrf.value === undefined) return;
    const value = vrf.value;
    if (needsApproval) {
      const ok = await tx.run(t("lot.txApprove"), () =>
        writeContractAsync({ address: token, abi: towackTokenAbi, functionName: "approve", args: [draw, amountIn], chainId }),
      );
      if (!ok) return;
    }
    const ok = await tx.run(t("lot.txEnter"), () => writeContractAsync({ ...c, functionName: "enter", args: [amountIn], value }));
    if (ok) {
      setFresh(true);
      void refetchMe();
      void refetchSpin();
      void refetch();
    }
  }
  const claim = () => tx.run(t("lot.txClaim"), () => writeContractAsync({ ...c, functionName: "claim" })).then(() => void refetchMe());
  const retry = () =>
    lastSpin &&
    vrf.value !== undefined &&
    tx.run(t("wheel.txRetry"), () => writeContractAsync({ ...c, functionName: "retrySpin", args: [lastSpin], value: vrf.value }));

  const chips: { label: string; v: bigint | undefined }[] = [
    { label: "100", v: MIN_WEI },
    { label: "1K", v: 1_000n * E18 },
    { label: "10K", v: 10_000n * E18 },
    { label: t("common.max"), v: maxEntry !== undefined && myTwak !== undefined ? (myTwak < maxEntry ? myTwak : maxEntry) : maxEntry },
  ];

  const warn = tooSmall
    ? t("lot.warnMin", { n: POOL_MIN_ENTRY })
    : tooBig
      ? t("lot.warnMax", { n: fmt18(maxEntry, 2), p: POOL_MAX_ENTRY_PCT })
      : tooMuch
        ? t("lot.warnBal")
        : undefined;

  return (
    <>
      {poolErr ? <RpcErrorNotice onRetry={() => void refetch()} label={t("lot.loadErr")} /> : null}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 [&>*]:min-w-0">
        <PoolStat
          label={t("lot.freePool")}
          value={freeTwak !== undefined ? <AnimatedNumber value={Number(formatEther(freeTwak))} /> : poolErr ? "—" : <Skeleton className="h-6 w-28" label={t("lot.loadingPool")} />}
          sub="TWAK"
        />
        <PoolStat
          label={t("lot.bnbPot")}
          value={freeBnb !== undefined ? <AnimatedNumber value={Number(formatEther(freeBnb))} decimals={Number(formatEther(freeBnb)) ? 4 : 0} /> : poolErr ? "—" : <Skeleton className="h-6 w-16" label={t("lot.loadingPot")} />} sub={bonus ? t("lot.upToMax", { n: fmt18(bonus[0], 4) }) : "BNB"} />
        <PoolStat label={t("lot.entry")} value={`${POOL_MIN_ENTRY} – ${maxEntry !== undefined ? fmt18(maxEntry, 0) : "—"}`} sub={t("lot.entrySub")} />
        <PoolStat label={t("lot.evStat")} value={`${POOL_EV_PCT}%`} sub={spinCount !== undefined ? t("lot.spinsSoFar", { n: spinCount.toString() }) : t("lot.perSpin")} />
      </div>

      <div className="mt-6" data-pool-wheel>
        <PoolWheelStage
          status={status}
          prizeId={status === "assigned" && s ? s[2] : undefined}
          entry={s?.[4]}
          bnb={spinPrize?.[1]}
          salt={lastSpin ? Number(lastSpin % 1000n) : 0}
          fresh={fresh}
          idleNote={t("lot.idle")}
          waitingNote={
            <>
              {lastSpin ? <Pill tone="neutral">{t("lot.spinPill", { n: lastSpin.toString() })}</Pill> : null}{" "}
              {requestedAt && now ? t("lot.requested", { d: fmtDuration(now - requestedAt) }) : ""}
              {canRetry ? (
                <div className="mt-3 flex justify-center">
                  <Button tone="line" size="sm" className="min-h-11" disabled={tx.busy || vrf.value === undefined} onClick={retry}>
                    {vrf.supported === false ? t("wheel.retry") : t("wheel.retryFee", { fee: vrf.label })}
                  </Button>
                </div>
              ) : null}
            </>
          }
          actions={
            status === "assigned" && s ? (
              <>
                {hasOwed ? (
                  <Button tone="gold" size="sm" className="min-h-11" disabled={tx.busy} onClick={claim}>
                    {tx.busy ? t("wallet.checkWallet") : t("lot.txClaim")}
                  </Button>
                ) : null}
                <ShareButton prizeId={s[2]} text={poolShareText(t, POOL_PRIZES[s[2]] ?? POOL_PRIZES[POOL_NO_WIN_ID])} path="/lottery" />
              </>
            ) : undefined
          }
        />
      </div>

      <div className="mt-2 border-t border-dashed border-line-2 pt-6">
        <NeedsWallet why={t("lot.connectWhy")} agent="lottery">
          {bound === false ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">{t("lot.notWired")}</p>
          ) : paused ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">{t("lot.paused")}</p>
          ) : poolOpen === false ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">{t("lot.tooSmall", { n: POOL_MIN_ENTRY })}</p>
          ) : (
            <>
              <label className="block text-[13px] font-semibold uppercase tracking-[.15em] text-muted" htmlFor="pool-entry">
                {t("lot.toEnter")}
              </label>
              <input
                id="pool-entry"
                className={`${inputClass} mt-2 min-w-0`}
                inputMode="decimal"
                placeholder={t("lot.placeholder", { n: POOL_MIN_ENTRY })}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <div className="mt-2 grid grid-cols-4 gap-2">
                {chips.map((ch) => (
                  <button
                    key={ch.label}
                    type="button"
                    disabled={ch.v === undefined}
                    onClick={() => ch.v !== undefined && setAmount(formatEther(ch.v))}
                    className="min-h-11 rounded-full border border-line bg-card font-display text-[15px] font-semibold disabled:opacity-40"
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm font-medium text-muted">{t("lot.balance", { n: fmt18(myTwak, 2) })}</p>
              {warn ? <p className="mt-1 font-medium text-down">{warn}</p> : null}
              {status === "waiting" ? <p className="mt-1 font-medium text-sub">{t("lot.stillLanding")}</p> : null}
              <Button tone="gold" size="lg" className="mt-4 min-h-14 w-full" disabled={!canEnter || tx.busy} onClick={enter}>
                {tx.busy ? t("wallet.checkWallet") : needsApproval && amountIn ? t("lot.btnApprove") : t("lot.btnEnter")}
              </Button>
              <p className="mt-2 text-center text-[12.5px] text-muted">
                {t("lot.entryNote")}
                {vrf.supported === false ? null : t("lot.vrfNote", { fee: vrf.label })}
              </p>
              <AgentPathToggle flow="lottery" className="mt-3" />
            </>
          )}
          {hasOwed && status !== "assigned" ? (
            <Button tone="soft" className="mt-4 w-full min-h-12" disabled={tx.busy} onClick={claim}>
              {t("lot.claimOwed", { twak: fmt18(owedTwak, 2), bnb: owedBnb > 0n ? ` + ${fmt18(owedBnb, 5)} BNB` : "" })}
            </Button>
          ) : null}
          {hasOwed ? <AgentPathToggle flow="lotteryClaim" className="mt-4" /> : null}
        </NeedsWallet>
        <RiskLine className="mt-3" />
      </div>
      <TxNotice state={tx.state} onClose={tx.reset} />
    </>
  );
}

// ---------------------------------------------------------------- page body

export function LotteryBooth() {
  const { has, addresses } = useTowack();
  const demo = usePoolDemo();
  const [amount, setAmount] = useState("");
  const { t } = useLocale();
  const live = has("drawV2");

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div id="pool" className="col-span-12 scroll-mt-24 lg:col-span-7">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[26px] font-semibold sm:text-[28px]">{t("lot.wheel")}</h2>
          </div>
          <div className="mt-3">
            <VrfSource consumer={addresses.drawV2} />
          </div>
          <div className="mt-4">
            {demo.active ? (
              <div data-pool-wheel>
                <DemoWheel />
              </div>
            ) : live ? (
              <LiveBooth amount={amount} setAmount={setAmount} />
            ) : (
              <>
                <PoolWheelStage status="none" idleNote={t("lot.unavailableIdle")} />
                <div className="rounded-2xl border border-dashed border-line bg-gold/5 px-4 py-5 text-center">
                  <div className="font-display text-[20px] font-semibold">{t("lot.unavailable")}</div>
                  <p className="mt-1 text-sm font-medium text-sub">{t("lot.checkBack")}</p>
                  <AgentPathToggle flow="lottery" className="mt-4" />
                </div>
              </>
            )}
            {demo.allowed && !demo.active ? (
              <p className="mt-2 text-center text-xs font-medium text-muted">
                {t("common.previewOnly")}{" "}
                <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=pool#pool">
                  {t("common.playDemo")}
                </a>
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <PayoutTable entry={parseAmount(amount)} />
        <HowItWorks />
        <TreasuryNote />
      </div>
    </div>
  );
}
