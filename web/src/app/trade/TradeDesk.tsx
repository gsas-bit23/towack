"use client";

import { useMemo, useState } from "react";
import { formatEther, maxUint256, parseEther } from "viem";
import { useBalance, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, pancakeRouterAbi, towackRouterAbi, towackTokenAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { ChainNote, NeedsContracts, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

const FEE_BPS = 100n;
const BPS = 10_000n;

function safeParse(v: string): bigint | undefined {
  if (!v.trim()) return undefined;
  try {
    const x = parseEther(v.trim() as `${number}`);
    return x > 0n ? x : undefined;
  } catch {
    return undefined;
  }
}

export function TradeDesk() {
  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 lg:col-span-7">
        <NeedsContracts keys={["router", "token", "pancakeRouter", "wbnb"]}>
          <SwapCard />
        </NeedsContracts>
      </div>
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <FeeSplit />
        <NeedsContracts keys={["router"]}>
          <LimitCard />
        </NeedsContracts>
      </div>
    </div>
  );
}

function SwapCard() {
  const { chainId, addresses, account } = useTowack();
  const router = addresses.router!;
  const token = addresses.token!;
  const pancake = addresses.pancakeRouter!;
  const wbnb = addresses.wbnb!;
  const now = useNow(5_000);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [deadlineMin, setDeadlineMin] = useState("10");

  const amountIn = safeParse(amount);
  const slipBps = (() => {
    const s = Number(slippage);
    if (!Number.isFinite(s) || s < 0.05 || s > 15) return undefined;
    return BigInt(Math.round(s * 100));
  })();
  const deadlineSec = (() => {
    const m = Number(deadlineMin);
    if (!Number.isFinite(m) || m < 1 || m > 60) return undefined;
    return Math.round(m * 60);
  })();

  const { data: routerAgent } = useReadContract({ address: router, abi: towackRouterAbi, functionName: "agentId", chainId });
  const registry = routerAgent ?? addresses.agentId;
  const { data: agentBal } = useReadContract({
    address: registry,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(registry && account) },
  });
  const hasAgent = agentBal === undefined ? undefined : agentBal > 0n;

  const { data: tokenData } = useReadContracts({
    contracts: [
      { address: token, abi: towackTokenAbi, functionName: "tradingOpen", chainId },
      { address: token, abi: towackTokenAbi, functionName: "balanceOf", args: account ? [account] : undefined, chainId },
      { address: token, abi: towackTokenAbi, functionName: "allowance", args: account ? [account, router] : undefined, chainId },
      { address: router, abi: towackRouterAbi, functionName: "effectiveLimit", args: account ? [account] : undefined, chainId },
      { address: router, abi: towackRouterAbi, functionName: "spentToday", args: account ? [account] : undefined, chainId },
    ],
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const { data: tradingOpenAnon } = useReadContract({ address: token, abi: towackTokenAbi, functionName: "tradingOpen", chainId });
  const tradingOpen = (tokenData?.[0]?.result as boolean | undefined) ?? tradingOpenAnon;
  const twakBal = tokenData?.[1]?.result as bigint | undefined;
  const allowance = tokenData?.[2]?.result as bigint | undefined;
  const limit = tokenData?.[3]?.result as bigint | undefined;
  const spent = tokenData?.[4]?.result as bigint | undefined;
  const { data: bnbBal } = useBalance({ address: account, chainId, query: { enabled: Boolean(account) } });

  // Quote: buys swap msg.value minus 1%; sells take 1% off the BNB output.
  const quoteIn = side === "buy" && amountIn ? amountIn - (amountIn * FEE_BPS) / BPS : amountIn;
  const path = side === "buy" ? ([wbnb, token] as const) : ([token, wbnb] as const);
  const { data: amounts, error: quoteError } = useReadContract({
    address: pancake,
    abi: pancakeRouterAbi,
    functionName: "getAmountsOut",
    args: quoteIn ? [quoteIn, [...path]] : undefined,
    chainId,
    query: { enabled: Boolean(quoteIn && tradingOpen), refetchInterval: 10_000 },
  });
  const rawOut = amounts?.[1];

  const q = useMemo(() => {
    if (!amountIn || rawOut === undefined || !slipBps) return undefined;
    if (side === "buy") {
      const fee = (amountIn * FEE_BPS) / BPS;
      const minOut = (rawOut * (BPS - slipBps)) / BPS;
      return { fee, out: rawOut, minOut, notional: amountIn };
    }
    const fee = (rawOut * FEE_BPS) / BPS;
    const net = rawOut - fee;
    const minOut = (net * (BPS - slipBps)) / BPS;
    return { fee, out: net, minOut, notional: rawOut };
  }, [amountIn, rawOut, slipBps, side]);

  const overLimit = q && limit !== undefined && spent !== undefined && limit !== maxUint256 ? spent + q.notional > limit : false;
  const insufficient =
    amountIn !== undefined && (side === "buy" ? (bnbBal ? amountIn > bnbBal.value : false) : twakBal !== undefined ? amountIn > twakBal : false);
  const needsApproval = side === "sell" && amountIn !== undefined && (allowance ?? 0n) < amountIn;

  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const ready = Boolean(account && tradingOpen && amountIn && q && slipBps && deadlineSec && now > 0 && !insufficient && !overLimit);

  async function submit() {
    if (!ready || !amountIn || !q || !deadlineSec) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);
    if (side === "buy") {
      await tx.run("Buy TWAK", () =>
        writeContractAsync({ address: router, abi: towackRouterAbi, functionName: "buy", args: [q.minOut, deadline], value: amountIn, chainId }),
      );
      return;
    }
    if (needsApproval) {
      // Exact approval: only the amount being sold. The router pulls all of it, leaving the allowance at 0.
      const ok = await tx.run("Approve exact amount", () =>
        writeContractAsync({ address: token, abi: towackTokenAbi, functionName: "approve", args: [router, amountIn], chainId }),
      );
      if (!ok) return;
    }
    const freshDeadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);
    await tx.run("Sell TWAK", () =>
      writeContractAsync({ address: router, abi: towackRouterAbi, functionName: "sell", args: [amountIn, q.minOut, freshDeadline], chainId }),
    );
  }

  const inUnit = side === "buy" ? "BNB" : "TWAK";
  const outUnit = side === "buy" ? "TWAK" : "BNB";

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[21px] font-semibold tracking-tight">Swap booth</h2>
        <ChainNote />
      </div>

      <div className="mt-5 inline-flex rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label="Swap direction">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => {
              setSide(s);
              setAmount("");
              tx.reset();
            }}
            className={`rounded-full px-6 py-2 font-display text-[17px] font-semibold ${side === s ? (s === "buy" ? "bg-card-2" : "bg-gold/10 text-fg") : "text-muted"}`}
          >
            {s === "buy" ? "Buy TWAK" : "Sell TWAK"}
          </button>
        ))}
      </div>

      {tradingOpen === false ? (
        <p className="mt-5 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
          Trading opens when the draw is finalized and the pair is listed at the mint price. Until then the pool is locked.
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        <Field
          label={`You pay (${inUnit})`}
          hint={
            account
              ? side === "buy"
                ? `Balance: ${bnbBal ? fmt18(bnbBal.value) : "—"} BNB`
                : `Balance: ${fmt18(twakBal, 2)} TWAK`
              : undefined
          }
        >
          <div className="flex gap-2">
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              aria-label={`Amount in ${inUnit}`}
            />
            {side === "sell" && twakBal ? (
              <Button tone="line" size="sm" onClick={() => setAmount(formatEther(twakBal))}>
                Max
              </Button>
            ) : null}
          </div>
        </Field>

        <div className="rounded-2xl border border-line bg-card-2 p-5">
          <div className="text-[13px] font-semibold uppercase tracking-widest text-muted">You get (estimate)</div>
          <div className="mt-1 font-mono text-[26px] font-medium tabular-nums tracking-tight">
            {q ? `${fmt18(q.out, side === "buy" ? 2 : 6)} ${outUnit}` : quoteError && amountIn ? "No quote" : `— ${outUnit}`}
          </div>
          {q ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-medium text-sub">
              <dt>Minimum after slippage</dt>
              <dd className="text-right">
                {fmt18(q.minOut, side === "buy" ? 2 : 6)} {outUnit}
              </dd>
              <dt>Router fee (1% of BNB leg)</dt>
              <dd className="text-right">{fmt18(q.fee, 6)} BNB</dd>
              <dt className="pl-3">→ 50% rebate boosts</dt>
              <dd className="text-right">{fmt18((q.fee * 5000n) / BPS, 6)} BNB</dd>
              <dt className="pl-3">→ 30% Draw V2 treasury</dt>
              <dd className="text-right">{fmt18((q.fee * 3000n) / BPS, 6)} BNB</dd>
              <dt className="pl-3">→ 20% dev</dt>
              <dd className="text-right">{fmt18(q.fee - (q.fee * 5000n) / BPS - (q.fee * 3000n) / BPS, 6)} BNB</dd>
            </dl>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Slippage %" hint="0.05–15. Default 1%.">
            <input className={inputClass} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value.replace(/[^0-9.]/g, ""))} />
          </Field>
          <Field label="Deadline (min)" hint="1–60. Default 10.">
            <input className={inputClass} inputMode="numeric" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value.replace(/[^0-9]/g, ""))} />
          </Field>
        </div>
        {slipBps && slipBps > 500n ? <p className="font-medium text-down">High slippage: you may get a much worse price.</p> : null}
      </div>

      <div className="mt-6">
        <NeedsWallet why="Connect any wallet to trade. Rebates accrue only if it holds an Agent ID." agent={side}>
          {hasAgent === false ? (
            <div className="mb-4 rounded-2xl border border-line bg-down/10 px-4 py-4 font-medium">
              <Pill tone="gold">NO REBATES FOR THIS WALLET</Pill>
              <p className="mt-2">
                Anyone can trade here, but this wallet doesn&apos;t hold an Agent ID, so its trades earn no rebate. You still pay the same 1%; your
                rebate half goes to the epoch&apos;s BNB boost pot for Agent ID traders. Agent IDs are issued in the official Binance App (mainnet).
              </p>
            </div>
          ) : hasAgent ? (
            <p className="mb-4 text-sm font-medium text-sub">
              <Pill tone="neutral">AGENT ID ✓</Pill> <span className="ml-1">Your trades earn weekly rebates on the Rebates page.</span>
            </p>
          ) : null}
          <>
            {overLimit ? <p className="mb-3 font-medium text-down">This trade would go over your daily limit.</p> : null}
            {insufficient ? <p className="mb-3 font-medium text-down">Not enough {inUnit} in this wallet.</p> : null}
            <Button tone={side === "buy" ? "soft" : "gold"} size="lg" className="w-full" disabled={!ready || tx.busy} onClick={submit}>
              {tx.busy
                ? "Check your wallet…"
                : side === "buy"
                  ? "Buy TWAK"
                  : needsApproval
                    ? "Approve exact amount, then sell"
                    : "Sell TWAK"}
            </Button>
            {side === "sell" ? (
              <p className="mt-3 text-center text-sm font-medium text-muted">
                Selling asks for two wallet confirmations: an approval for exactly {amountIn ? fmt18(amountIn, 2) : "the"} TWAK, then the sell. Never
                an unlimited approval.
              </p>
            ) : (
              <p className="mt-3 text-center text-sm font-medium text-muted">You confirm every swap in your wallet. We never sign for you.</p>
            )}
          </>
          <TxNotice state={tx.state} onClose={tx.reset} />
          <AgentPathToggle key={side} flow={side} className="mt-4" />
        </NeedsWallet>
      </div>
      <p className="mt-6 text-sm font-semibold text-muted">Trading involves risk. Prices can move fast, and you can lose money. Quotes are estimates.</p>
    </Panel>
  );
}

function FeeSplit() {
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">Where the 1% goes</h2>
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        <div className="bg-gold" style={{ flex: 50 }} />
        <div className="bg-up" style={{ flex: 30 }} />
        <div className="bg-[#4A525E]" style={{ flex: 20 }} />
      </div>
      <ul className="mt-4 space-y-2 font-medium">
        <li>
          <span className="font-mono text-[18px] font-medium text-gold">50%</span> Active-trader rebate boosts (claim on Rebates)
        </li>
        <li>
          <span className="font-mono text-[18px] font-medium text-up">30%</span> Lottery / Draw V2 treasury
        </li>
        <li>
          <span className="font-mono text-[18px] font-medium text-sub">20%</span> Dev
        </li>
      </ul>
      <p className="mt-3 text-sm font-semibold text-sub">Buys: 1% of the BNB you send. Sells: 1% of the BNB you get back. TWAK transfers are never taxed.</p>
    </Panel>
  );
}

function LimitCard() {
  const { chainId, addresses, account } = useTowack();
  const router = addresses.router!;
  const now = useNow();
  const [newLimit, setNewLimit] = useState("");
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const { data } = useReadContracts({
    contracts: [
      { address: router, abi: towackRouterAbi, functionName: "effectiveLimit", args: account ? [account] : undefined, chainId },
      { address: router, abi: towackRouterAbi, functionName: "spentToday", args: account ? [account] : undefined, chainId },
      { address: router, abi: towackRouterAbi, functionName: "leashOf", args: account ? [account] : undefined, chainId },
    ],
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const limit = data?.[0]?.result as bigint | undefined;
  const spent = data?.[1]?.result as bigint | undefined;
  const leash = data?.[2]?.result as readonly [bigint, bigint, bigint, bigint, bigint] | undefined;
  const pendingLimit = leash?.[1];
  const pendingAt = leash?.[2];
  const hasPending = pendingAt !== undefined && pendingAt > 0n && now > 0 && BigInt(now) < pendingAt;

  const parsed = safeParse(newLimit);
  const isRaise = parsed !== undefined && limit !== undefined && parsed > limit;

  // maxUint256 here is the router's UNLIMITED daily-limit sentinel, never a token approval.
  const set = (value: bigint, label: string) =>
    tx.run(label, () => writeContractAsync({ address: router, abi: towackRouterAbi, functionName: "setDailyLimit", args: [value], chainId }));

  return (
    <Panel>
      <h2 className="text-[20px] font-semibold tracking-tight">Your daily limit</h2>
      <p className="mt-1 font-semibold text-sub">
        A leash on how much BNB-leg volume this wallet can trade per UTC day. <b>Lowering it is immediate. Raising it takes effect after 24 hours</b>, so a
        leaked key can&apos;t lift its own leash.
      </p>
      <div className="mt-5">
        <NeedsWallet>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Limit" value={limit === undefined ? "—" : limit === maxUint256 ? "Unlimited" : `${fmt18(limit)} BNB`} />
            <Stat label="Used today" value={`${fmt18(spent)} BNB`} />
          </div>
          {hasPending ? (
            <p className="mt-3 rounded-2xl border border-line bg-gold/5 px-4 py-2 font-medium">
              Pending raise to {pendingLimit === maxUint256 ? "unlimited" : `${fmt18(pendingLimit)} BNB`} at {fmtDate(pendingAt)}.
            </p>
          ) : null}
          <div className="mt-4">
            <Field label="New limit (BNB per day)" hint={parsed !== undefined ? (isRaise ? "This is a raise: active in 24h." : "This is a decrease: active now.") : undefined}>
              <input className={inputClass} inputMode="decimal" placeholder="e.g. 0.5" value={newLimit} onChange={(e) => setNewLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button tone="soft" size="sm" disabled={!parsed || tx.busy} onClick={() => parsed && set(parsed, "Set daily limit")}>
              Set limit
            </Button>
            <Button tone="line" size="sm" disabled={tx.busy || limit === maxUint256} onClick={() => set(maxUint256, "Remove limit")}>
              Remove limit (after 24h)
            </Button>
          </div>
          <TxNotice state={tx.state} onClose={tx.reset} />
        </NeedsWallet>
      </div>
    </Panel>
  );
}
