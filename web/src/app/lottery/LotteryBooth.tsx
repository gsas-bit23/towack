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
import { AddressLink, ChainNote, NeedsWallet, RpcErrorNotice, TxNotice, VrfSource } from "@/components/status";
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
  poolShareText,
} from "@/lib/poolPrizes";
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
  const prize = poolPrizeById(prizeId);
  const showResult = landed && prize !== undefined && status === "assigned";
  const paid = prize && entry !== undefined ? payoutFor(entry, prize) : undefined;
  const vsEntry = prize ? (prize.multBps < 10_000 ? "less than you put in" : prize.multBps === 10_000 ? "your entry back" : "more than you put in") : "";

  return (
    <div className="relative">
      {demo ? (
        <div className="mb-4 flex justify-center">
          <Pill tone="gold" className="border border-line text-[13px]">
            DEMO SPIN · not a real entry or prize
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
              {status === "waiting" ? "Spinning… waiting for VRF" : "Here it comes…"}
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
            <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">{demo ? "Demo landed on" : "The wheel says"}</div>
            <div className={`mt-1 text-[26px] font-semibold leading-tight tracking-tight sm:text-[28px] ${prize.jackpot ? "text-gold" : ""}`}>{prize.label}</div>
            {paid !== undefined && entry !== undefined ? (
              <>
                <div className="mt-1 text-[18px] font-semibold">
                  {prize.multBps === 0 ? "0 TWAK — the entry stays in the pool" : `${fmt18(paid, 2)} TWAK`}
                  {bnb && bnb > 0n ? ` + ${fmt18(bnb, 5)} BNB bonus` : ""}
                </div>
                <div className="mt-1 text-sm font-medium text-muted">
                  From a {fmt18(entry, 2)} TWAK entry{prize.multBps === 0 ? "." : ` — ${vsEntry}.`}
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
  useEffect(() => {
    const t = setTimeout(() => setStatus("assigned"), 2800);
    return () => clearTimeout(t);
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
      waitingNote="Demo only — no transaction, no VRF."
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
          Spin the demo again
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
  return (
    <Panel tone="card" shadow={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[24px] font-semibold">Payout table</h2>
        <span className="text-sm font-semibold text-muted">10,000 slots · per {fmt18(e, 0)} TWAK</span>
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2" role="table" aria-label="Pool wheel payout table">
        <div role="row" className="contents text-[11px] font-semibold uppercase tracking-[.15em] text-muted">
          <span role="columnheader">Tier</span>
          <span role="columnheader">Odds</span>
          <span role="columnheader" className="text-right">
            Pays
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
                {p.slots.toLocaleString("en-US")} slots{p.bnbBonusBps ? ` · up to +${p.bnbBonusBps / 100}% BNB pot` : ""}
              </span>
            </span>
            <span role="cell" className="whitespace-nowrap text-right font-display text-[15px] font-semibold">
              {p.multBps === 0 ? "0" : fmt18(payoutFor(e, p), 0)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-gold/5 px-4 py-3">
        <div className="font-display text-[20px] font-semibold">Expected return: {POOL_EV_PCT}%</div>
        <p className="mt-1 text-sm font-medium text-sub">
          On average a spin pays back 95 of every 100 TWAK entered; the 5% edge stays in the pool. {POOL_SPLIT.less}% of spins pay less than the
          entry, {POOL_SPLIT.even}% pay it back, {POOL_SPLIT.more}% pay more. This is a game of chance, not an investment.
        </p>
      </div>
    </Panel>
  );
}

function HowItWorks() {
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="font-display text-[24px] font-semibold">How the pool wheel works</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 font-medium text-sub">
        <li>Your TWAK goes into the prize pool (nothing is burned). Each entry asks Chainlink VRF for one random number and spins right away.</li>
        <li>The wheel pays a multiplier of your entry from the pool: 0× to 10×. Prizes are pulled with Claim.</li>
        <li>
          Min {POOL_MIN_ENTRY} TWAK. Max {POOL_MAX_ENTRY_PCT}% of the free pool, so a 10× win is at most {POOL_MAX_PAYOUT_PCT}% of it.
        </li>
        <li>Every pending spin locks 10× its entry, so many spins at once can never overdraw the pool.</li>
        <li>5× and 10× also win up to 1% / 2% of the free BNB pot, scaled linearly by your entry size relative to the max entry (locked on entry). Empty pot = TWAK only.</li>
        <li>The owner (a timelock) can only pause new entries. It cannot withdraw TWAK or BNB.</li>
      </ol>
    </Panel>
  );
}

function TreasuryNote() {
  const { addresses, meta } = useTowack();
  if (!meta.testnet) {
    return (
      <Panel tone="raised" shadow={false}>
        <Pill tone="gold">POOL &amp; VRF</Pill>
        <p className="mt-3 font-medium text-sub">
          The Draw V2 pool wheel is funded with the full {POOL_INTENDED_SEED} allocation and draws with the official Chainlink VRF v2.5
          direct-funding wrapper: each spin pays its own small VRF fee in native BNB (excess refunded), with no subscription.
        </p>
      </Panel>
    );
  }
  return (
    <Panel tone="raised" shadow={false}>
      <Pill tone="gold">TESTNET NOTE</Pill>
      <p className="mt-3 font-medium text-sub">
        The live testnet pool wheel holds the full {POOL_INTENDED_SEED} Draw V2 allocation and draws with the official Chainlink VRF v2.5
        direct-funding wrapper: each spin pays its own small VRF fee in native BNB (excess refunded), with no subscription. Earlier
        testnet pools are retired history, including the skeleton treasury and the mock-VRF pool.
      </p>
      {addresses.drawV2Legacy ? (
        <p className="mt-3 break-all text-sm font-medium text-sub">
          Old treasury: <AddressLink address={addresses.drawV2Legacy} />
        </p>
      ) : null}
      {addresses.drawV2Mock ? (
        <p className="mt-1 break-all text-sm font-medium text-sub">
          Retired test pool: <AddressLink address={addresses.drawV2Mock} />
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
      const ok = await tx.run("Approve exact amount", () =>
        writeContractAsync({ address: token, abi: towackTokenAbi, functionName: "approve", args: [draw, amountIn], chainId }),
      );
      if (!ok) return;
    }
    const ok = await tx.run("Enter + spin", () => writeContractAsync({ ...c, functionName: "enter", args: [amountIn], value }));
    if (ok) {
      setFresh(true);
      void refetchMe();
      void refetchSpin();
      void refetch();
    }
  }
  const claim = () => tx.run("Claim prizes", () => writeContractAsync({ ...c, functionName: "claim" })).then(() => void refetchMe());
  const retry = () =>
    lastSpin &&
    vrf.value !== undefined &&
    tx.run("Retry VRF", () => writeContractAsync({ ...c, functionName: "retrySpin", args: [lastSpin], value: vrf.value }));

  const chips: { label: string; v: bigint | undefined }[] = [
    { label: "100", v: MIN_WEI },
    { label: "1K", v: 1_000n * E18 },
    { label: "10K", v: 10_000n * E18 },
    { label: "Max", v: maxEntry !== undefined && myTwak !== undefined ? (myTwak < maxEntry ? myTwak : maxEntry) : maxEntry },
  ];

  const warn = tooSmall
    ? `Minimum entry is ${POOL_MIN_ENTRY} TWAK.`
    : tooBig
      ? `Max entry right now is ${fmt18(maxEntry, 2)} TWAK (${POOL_MAX_ENTRY_PCT}% of the free pool).`
      : tooMuch
        ? "Not enough TWAK in this wallet."
        : undefined;

  return (
    <>
      {poolErr ? <RpcErrorNotice onRetry={() => void refetch()} label="Could not load pool wheel stats." /> : null}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 [&>*]:min-w-0">
        <PoolStat
          label="Free pool"
          value={freeTwak !== undefined ? <AnimatedNumber value={Number(formatEther(freeTwak))} /> : poolErr ? "—" : <Skeleton className="h-6 w-28" label="Loading pool" />}
          sub="TWAK"
        />
        <PoolStat
          label="BNB pot"
          value={freeBnb !== undefined ? <AnimatedNumber value={Number(formatEther(freeBnb))} decimals={Number(formatEther(freeBnb)) ? 4 : 0} /> : poolErr ? "—" : <Skeleton className="h-6 w-16" label="Loading BNB pot" />} sub={bonus ? `up to +${fmt18(bonus[0], 4)} at max entry` : "BNB"} />
        <PoolStat label="Entry" value={`${POOL_MIN_ENTRY} – ${maxEntry !== undefined ? fmt18(maxEntry, 0) : "—"}`} sub="TWAK min – max" />
        <PoolStat label="Expected return" value={`${POOL_EV_PCT}%`} sub={spinCount !== undefined ? `${spinCount.toString()} spins so far` : "per spin, on average"} />
      </div>

      <div className="mt-6" data-pool-wheel>
        <PoolWheelStage
          status={status}
          prizeId={status === "assigned" && s ? s[2] : undefined}
          entry={s?.[4]}
          bnb={spinPrize?.[1]}
          salt={lastSpin ? Number(lastSpin % 1000n) : 0}
          fresh={fresh}
          idleNote="Enter to spin. Each entry lands on its own Chainlink VRF number."
          waitingNote={
            <>
              {lastSpin ? <Pill tone="neutral">SPIN #{lastSpin.toString()}</Pill> : null} {requestedAt && now ? `Requested ${fmtDuration(now - requestedAt)} ago.` : ""}
              {canRetry ? (
                <div className="mt-3 flex justify-center">
                  <Button tone="line" size="sm" className="min-h-11" disabled={tx.busy || vrf.value === undefined} onClick={retry}>
                    {vrf.supported === false ? "Retry VRF request" : `Retry VRF request (+${vrf.label} VRF fee)`}
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
                    {tx.busy ? "Check your wallet…" : "Claim prizes"}
                  </Button>
                ) : null}
                <ShareButton prizeId={s[2]} text={poolShareText(s[2])} path="/lottery" />
              </>
            ) : undefined
          }
        />
      </div>

      <div className="mt-2 border-t border-dashed border-line-2 pt-6">
        <NeedsWallet why="Connect any wallet to enter the pool wheel. No Agent ID needed." agent="lottery">
          {bound === false ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">The pool wheel is deployed but not wired to the token yet.</p>
          ) : paused ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">New entries are paused. Pending spins still land and claims still work.</p>
          ) : poolOpen === false ? (
            <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">The free pool is too small for a {POOL_MIN_ENTRY} TWAK entry right now.</p>
          ) : (
            <>
              <label className="block text-[13px] font-semibold uppercase tracking-[.15em] text-muted" htmlFor="pool-entry">
                TWAK to enter
              </label>
              <input
                id="pool-entry"
                className={`${inputClass} mt-2 min-w-0`}
                inputMode="decimal"
                placeholder={`${POOL_MIN_ENTRY} or more`}
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
              <p className="mt-2 text-sm font-medium text-muted">Balance: {fmt18(myTwak, 2)} TWAK</p>
              {warn ? <p className="mt-1 font-medium text-down">{warn}</p> : null}
              {status === "waiting" ? <p className="mt-1 font-medium text-sub">Your last spin is still landing.</p> : null}
              <Button tone="gold" size="lg" className="mt-4 min-h-14 w-full" disabled={!canEnter || tx.busy} onClick={enter}>
                {tx.busy ? "Check your wallet…" : needsApproval && amountIn ? "Approve exact amount, then spin" : "Enter + spin"}
              </Button>
              <p className="mt-2 text-center text-sm font-medium text-muted">
                Your entry joins the pool. Most spins pay back less than you put in.
                {vrf.supported === false ? null : ` Each spin also sends a Chainlink VRF fee of about ${vrf.label} in BNB (pays for the random draw, not the pot; any extra is refunded).`}
              </p>
              <AgentPathToggle flow="lottery" className="mt-4" />
            </>
          )}
          {hasOwed && status !== "assigned" ? (
            <Button tone="soft" className="mt-4 w-full min-h-12" disabled={tx.busy} onClick={claim}>
              Claim {fmt18(owedTwak, 2)} TWAK{owedBnb > 0n ? ` + ${fmt18(owedBnb, 5)} BNB` : ""}
            </Button>
          ) : null}
          {hasOwed ? <AgentPathToggle flow="lotteryClaim" className="mt-4" /> : null}
        </NeedsWallet>
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
  const live = has("drawV2");

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div id="pool" className="col-span-12 scroll-mt-24 lg:col-span-7">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[26px] font-semibold sm:text-[28px]">Pool wheel</h2>
            <ChainNote />
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
                <PoolWheelStage status="none" idleNote="The pool wheel is launching soon on this network. Nothing to sign yet." />
                <div className="rounded-2xl border border-dashed border-line bg-gold/5 px-4 py-5 text-center">
                  <div className="font-display text-[20px] font-semibold">Pool wheel launching soon</div>
                  <p className="mt-1 text-sm font-medium text-sub">Draw V2 contracts are not deployed on this network yet.</p>
                  <AgentPathToggle flow="lottery" className="mt-4" />
                </div>
              </>
            )}
            {demo.allowed && !demo.active ? (
              <p className="mt-2 text-center text-xs font-medium text-muted">
                Preview only:{" "}
                <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=pool#pool">
                  play a demo spin
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
