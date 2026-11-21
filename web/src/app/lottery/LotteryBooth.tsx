"use client";

import { useState } from "react";
import { formatEther, parseEther, zeroAddress } from "viem";
import { useBalance, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { drawV2Abi, towackTokenAbi } from "@/abi";
import { AddressLink, ChainNote, DeployingSoon, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

type RoundTuple = readonly [bigint, bigint, bigint, bigint, boolean, boolean, `0x${string}`, bigint, bigint, boolean];

function HowItWorks() {
  return (
    <Panel tone="skyPale" shadow={false}>
      <h2 className="font-display text-[24px] font-extrabold">How a round works</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 font-bold text-navy/80">
        <li>Rounds last 7 days. Enter by burning TWAK: tickets = floor(TWAK × USD price), 1 ticket per $1.</li>
        <li>The TWAK price comes from a price source or a manual setting, both behind a 48-hour timelock. Never a raw spot price.</li>
        <li>After the round ends, anyone can request the Chainlink VRF draw, then anyone can settle it.</li>
        <li>One winner per round: up to 700,000 TWAK + 20% of the free BNB pot at settle time.</li>
        <li>The winner pulls the prize. The owner cannot withdraw prize funds.</li>
      </ol>
      <p className="mt-3 text-sm font-semibold text-navy/70">MVP contract. Odds depend on how many tickets everyone buys. Nothing is promised.</p>
    </Panel>
  );
}

export function LotteryBooth() {
  const { has } = useTowack();
  if (!has("drawV2")) {
    return (
      <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
        <div className="col-span-12 lg:col-span-7">
          <DeployingSoon keys={["drawV2"]}>
            <p className="font-bold text-navy/70">No rounds yet. There is no live jackpot until the contract is deployed and a round has tickets.</p>
          </DeployingSoon>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <HowItWorks />
        </div>
      </div>
    );
  }
  return <LiveBooth />;
}

function LiveBooth() {
  const { chainId, addresses, account } = useTowack();
  const draw = addresses.drawV2!;
  const now = useNow(10_000);
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const [lookup, setLookup] = useState("");

  const c = { address: draw, abi: drawV2Abi, chainId } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...c, functionName: "currentRound" },
      { ...c, functionName: "startTime" },
      { ...c, functionName: "ROUND_LENGTH" },
      { ...c, functionName: "twakUsdPrice" },
      { ...c, functionName: "priceSource" },
      { ...c, functionName: "token" },
      { ...c, functionName: "owedBnb" },
      { ...c, functionName: "owedTokens" },
      { ...c, functionName: "TOKEN_PRIZE_PER_ROUND" },
      { ...c, functionName: "VRF_RETRY_DELAY" },
    ],
    query: { refetchInterval: 20_000 },
  });
  const round = data?.[0]?.result as bigint | undefined;
  const start = data?.[1]?.result as bigint | undefined;
  const roundLen = (data?.[2]?.result as bigint | undefined) ?? 604800n;
  const price = data?.[3]?.result as bigint | undefined; // reverts NoPrice when unset → undefined
  const priceSource = data?.[4]?.result as `0x${string}` | undefined;
  const boundToken = data?.[5]?.result as `0x${string}` | undefined;
  const owedBnb = (data?.[6]?.result as bigint | undefined) ?? 0n;
  const owedTokens = (data?.[7]?.result as bigint | undefined) ?? 0n;
  const tokenPrize = (data?.[8]?.result as bigint | undefined) ?? 700_000n * 10n ** 18n;
  const retryDelay = (data?.[9]?.result as bigint | undefined) ?? 86400n;
  const token = boundToken && boundToken !== zeroAddress ? boundToken : addresses.token;
  const bound = boundToken ? boundToken !== zeroAddress : undefined;

  const prev = round !== undefined && round > 0n ? round - 1n : undefined;
  const lookupN = lookup.trim() && /^\d+$/.test(lookup.trim()) ? BigInt(lookup.trim()) : prev;

  const { data: rd } = useReadContracts({
    contracts: [
      { ...c, functionName: "rounds", args: round !== undefined ? [round] : undefined },
      { ...c, functionName: "ticketsOf", args: round !== undefined && account ? [round, account] : undefined },
      { ...c, functionName: "rounds", args: lookupN !== undefined ? [lookupN] : undefined },
      { ...c, functionName: "ticketsOf", args: lookupN !== undefined && account ? [lookupN, account] : undefined },
    ],
    query: { enabled: round !== undefined, refetchInterval: 20_000 },
  });
  const cur = rd?.[0]?.result as RoundTuple | undefined;
  const myCur = rd?.[1]?.result as bigint | undefined;
  const past = rd?.[2]?.result as RoundTuple | undefined;
  const myPast = rd?.[3]?.result as bigint | undefined;

  const { data: potBal } = useBalance({ address: draw, chainId });
  const { data: tokData } = useReadContracts({
    contracts: [
      { address: token, abi: towackTokenAbi, functionName: "balanceOf", args: [draw], chainId },
      { address: token, abi: towackTokenAbi, functionName: "balanceOf", args: account ? [account] : undefined, chainId },
      { address: token, abi: towackTokenAbi, functionName: "allowance", args: account ? [account, draw] : undefined, chainId },
    ],
    query: { enabled: Boolean(token), refetchInterval: 20_000 },
  });
  const drawTwak = tokData?.[0]?.result as bigint | undefined;
  const myTwak = tokData?.[1]?.result as bigint | undefined;
  const allowance = tokData?.[2]?.result as bigint | undefined;

  const { data: hasPrevPending } = useReadContract({
    ...c,
    functionName: "entriesLength",
    args: prev !== undefined ? [prev] : undefined,
    query: { enabled: prev !== undefined },
  });

  let amountIn: bigint | undefined;
  try {
    amountIn = amount.trim() ? parseEther(amount.trim() as `${number}`) : undefined;
  } catch {
    amountIn = undefined;
  }
  const tickets = amountIn && price ? (amountIn * price) / 10n ** 36n : 0n;
  const freeBnb = potBal ? (potBal.value > owedBnb ? potBal.value - owedBnb : 0n) : undefined;
  const freeTwak = drawTwak !== undefined ? (drawTwak > owedTokens ? drawTwak - owedTokens : 0n) : undefined;
  const estTwakPrize = freeTwak !== undefined ? (freeTwak < tokenPrize ? freeTwak : tokenPrize) : undefined;
  const endsAt = start !== undefined && round !== undefined ? Number(start + (round + 1n) * roundLen) : undefined;
  const needsApproval = amountIn !== undefined && (allowance ?? 0n) < amountIn;
  const tooMuch = amountIn !== undefined && myTwak !== undefined && amountIn > myTwak;
  const canEnter = Boolean(account && bound && price && tickets > 0n && !tooMuch);

  async function enter() {
    if (!canEnter || !amountIn || !token) return;
    if (needsApproval) {
      const ok = await tx.run("Approve exact amount", () =>
        writeContractAsync({ address: token, abi: towackTokenAbi, functionName: "approve", args: [draw, amountIn!], chainId }),
      );
      if (!ok) return;
    }
    const ok = await tx.run("Burn TWAK for tickets", () =>
      writeContractAsync({ address: draw, abi: drawV2Abi, functionName: "enter", args: [amountIn!], chainId }),
    );
    if (ok) setAmount("");
  }

  const pastStatus = past
    ? past[0] === 0n
      ? "No tickets"
      : past[5]
        ? past[9]
          ? "Prize claimed"
          : "Settled"
        : past[4]
          ? "Seed in — ready to settle"
          : past[1] > 0n
            ? "VRF requested"
            : "Waiting for draw request"
    : "—";
  const isWinner = Boolean(account && past && past[5] && past[6].toLowerCase() === account.toLowerCase());
  const pastOver = lookupN !== undefined && round !== undefined && lookupN < round;
  const canRequest =
    pastOver && past && past[0] > 0n && !past[4] && (past[1] === 0n || (now > 0 && BigInt(now) >= past[2] + retryDelay));
  const canSettle = past && past[4] && !past[5];

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 space-y-8 lg:col-span-7">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[28px] font-extrabold">Round {round !== undefined ? `#${round}` : "—"}</h2>
            <ChainNote />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Stat label="Ends in" value={endsAt && now ? fmtDuration(endsAt - now) : "—"} sub={endsAt ? fmtDate(endsAt) : undefined} />
            <Stat label="Tickets in round" value={cur ? cur[0].toLocaleString("en-US") : "0"} sub={account ? `yours: ${(myCur ?? 0n).toLocaleString("en-US")}` : undefined} />
            <Stat
              label="Ticket price"
              value={price ? `$1 ≈ ${fmt18(10n ** 36n / price, 2)} TWAK` : "Not set yet"}
              sub={priceSource && priceSource !== zeroAddress ? "from price source" : price ? "manual price (timelocked)" : "entries paused until set"}
            />
            <Stat
              label="Next prize (if settled now)"
              value={estTwakPrize !== undefined ? `${fmt18(estTwakPrize, 0)} TWAK` : "—"}
              sub={freeBnb !== undefined ? `+ ${fmt18((freeBnb * 2000n) / 10000n, 4)} BNB (20% of free pot)` : undefined}
            />
          </div>
          <p className="mt-3 text-sm font-semibold text-navy/60">Prize estimates read the contract&apos;s current balances and change until the round is settled.</p>

          <div className="mt-6 border-t-2 border-dashed border-navy/20 pt-6">
            <NeedsWallet why="Connect to burn TWAK for tickets.">
              {bound === false ? (
                <p className="rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">Draw V2 is deployed but not wired to the token yet.</p>
              ) : !price ? (
                <p className="rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
                  The ticket price hasn&apos;t been set yet (it goes through a 48h timelock). Entries open once it is.
                </p>
              ) : (
                <>
                  <Field label="TWAK to burn" hint={`Balance: ${fmt18(myTwak, 2)} TWAK`}>
                    <div className="flex gap-2">
                      <input className={inputClass} inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                      {myTwak ? (
                        <Button tone="white" size="sm" onClick={() => setAmount(formatEther(myTwak))}>
                          Max
                        </Button>
                      ) : null}
                    </div>
                  </Field>
                  <div className="mt-3 font-display text-[22px] font-extrabold">= {tickets.toLocaleString("en-US")} ticket{tickets === 1n ? "" : "s"}</div>
                  {tooMuch ? <p className="mt-2 font-bold text-candy-deep">Not enough TWAK.</p> : null}
                  <Button tone="candy" className="mt-4 w-full" disabled={!canEnter || tx.busy} onClick={enter}>
                    {tx.busy ? "Check your wallet…" : needsApproval ? "Approve exact amount, then enter" : "Burn TWAK & enter"}
                  </Button>
                  <p className="mt-2 text-center text-sm font-bold text-navy/60">Burned TWAK is destroyed, win or lose. Approval is for this exact amount only.</p>
                </>
              )}
            </NeedsWallet>
          </div>
          <TxNotice state={tx.state} onClose={tx.reset} />
        </Panel>

        <Panel tone="sunPale" shadow={false}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[24px] font-extrabold">Past round {lookupN !== undefined ? `#${lookupN}` : ""}</h2>
            <label className="flex items-center gap-2 font-bold">
              Round #
              <input
                className="w-24 rounded-xl border-[3px] border-navy bg-white px-3 py-1.5 font-display font-extrabold"
                inputMode="numeric"
                placeholder={prev !== undefined ? prev.toString() : "0"}
                value={lookup}
                onChange={(e) => setLookup(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          </div>
          {lookupN === undefined ? (
            <p className="mt-3 font-bold text-navy/70">No finished rounds yet.</p>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Stat label="Status" value={pastStatus} />
                <Stat label="Tickets" value={past ? past[0].toLocaleString("en-US") : "—"} sub={account ? `yours: ${(myPast ?? 0n).toLocaleString("en-US")}` : undefined} />
                <Stat
                  label="Winner"
                  value={past && past[5] ? <AddressLink address={past[6]} /> : "—"}
                  sub={past && past[5] ? `${fmt18(past[7], 0)} TWAK + ${fmt18(past[8], 4)} BNB` : undefined}
                />
              </div>
              {isWinner && past && !past[9] ? (
                <Button
                  tone="candy"
                  className="mt-5"
                  disabled={tx.busy}
                  onClick={() => tx.run("Claim prize", () => writeContractAsync({ address: draw, abi: drawV2Abi, functionName: "claimPrize", args: [lookupN], chainId }))}
                >
                  You won — claim prize
                </Button>
              ) : null}
              {account && (canRequest || canSettle) ? (
                <div className="mt-5 flex flex-wrap gap-3">
                  {canRequest ? (
                    <Button
                      tone="white"
                      size="sm"
                      disabled={tx.busy}
                      onClick={() => tx.run("Request draw", () => writeContractAsync({ address: draw, abi: drawV2Abi, functionName: "requestDraw", args: [lookupN], chainId }))}
                    >
                      Request VRF draw
                    </Button>
                  ) : null}
                  {canSettle ? (
                    <Button
                      tone="sky"
                      size="sm"
                      disabled={tx.busy}
                      onClick={() => tx.run("Settle round", () => writeContractAsync({ address: draw, abi: drawV2Abi, functionName: "settle", args: [lookupN], chainId }))}
                    >
                      Settle round
                    </Button>
                  ) : null}
                  <span className="self-center text-sm font-bold text-navy/60">Permissionless — anyone can move the round forward (gas only).</span>
                </div>
              ) : null}
              {hasPrevPending !== undefined && prev !== undefined && lookupN === prev && hasPrevPending === 0n ? (
                <p className="mt-3 text-sm font-bold text-navy/60">Nobody entered last round, so there was no draw.</p>
              ) : null}
            </>
          )}
        </Panel>
      </div>
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <HowItWorks />
        <Panel tone="navy" shadow={false}>
          <Pill tone="sun">TREASURY</Pill>
          <p className="mt-3 font-bold text-white/85">
            Draw V2 holds the 70M TWAK prize allocation and receives BNB from Draw V1 leftovers, 30% of router fees, and unclaimed Draw V1 refunds.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-navy">
            <Stat label="Free BNB" value={fmt18(freeBnb, 4)} />
            <Stat label="Free TWAK" value={fmt18(freeTwak, 0)} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
