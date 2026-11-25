"use client";

import { useMemo, useState } from "react";
import { formatEther, maxUint256, parseEther } from "viem";
import { useBalance, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, pancakeRouterAbi, towackRouterAbi, towackTokenAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { RiskLine } from "@/components/RiskNote";
import { NeedsContracts, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useLocale } from "@/lib/i18n";

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
  const { t } = useLocale();

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
      await tx.run(t("trade.buy"), () =>
        writeContractAsync({ address: router, abi: towackRouterAbi, functionName: "buy", args: [q.minOut, deadline], value: amountIn, chainId }),
      );
      return;
    }
    if (needsApproval) {
      // Exact approval: only the amount being sold. The router pulls all of it, leaving the allowance at 0.
      const ok = await tx.run(t("trade.txApprove"), () =>
        writeContractAsync({ address: token, abi: towackTokenAbi, functionName: "approve", args: [router, amountIn], chainId }),
      );
      if (!ok) return;
    }
    const freshDeadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);
    await tx.run(t("trade.sell"), () =>
      writeContractAsync({ address: router, abi: towackRouterAbi, functionName: "sell", args: [amountIn, q.minOut, freshDeadline], chainId }),
    );
  }

  const inUnit = side === "buy" ? "BNB" : "TWAK";
  const outUnit = side === "buy" ? "TWAK" : "BNB";

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[21px] font-semibold tracking-tight">{t("trade.booth")}</h2>
      </div>

      <div className="mt-5 inline-flex rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label={t("trade.dirAria")}>
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
            {s === "buy" ? t("trade.buy") : t("trade.sell")}
          </button>
        ))}
      </div>

      {tradingOpen === false ? (
        <p className="mt-5 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
          {t("trade.locked")}
        </p>
      ) : null}

      <div className="mt-6 space-y-5">
        <Field
          label={t("trade.youPay", { unit: inUnit })}
          hint={
            account
              ? side === "buy"
                ? t("trade.balance", { n: bnbBal ? fmt18(bnbBal.value) : "—", unit: "BNB" })
                : t("trade.balance", { n: fmt18(twakBal, 2), unit: "TWAK" })
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
              aria-label={t("trade.amountIn", { unit: inUnit })}
            />
            {side === "sell" && twakBal ? (
              <Button tone="line" size="sm" onClick={() => setAmount(formatEther(twakBal))}>
                {t("common.max")}
              </Button>
            ) : null}
          </div>
        </Field>

        <div className="rounded-2xl border border-line bg-card-2 p-5">
          <div className="text-[13px] font-semibold uppercase tracking-widest text-muted">{t("trade.youGet")}</div>
          <div className="mt-1 font-mono text-[26px] font-medium tabular-nums tracking-tight">
            {q ? `${fmt18(q.out, side === "buy" ? 2 : 6)} ${outUnit}` : quoteError && amountIn ? t("trade.noQuote") : `— ${outUnit}`}
          </div>
          {q ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-medium text-sub">
              <dt>{t("trade.minAfter")}</dt>
              <dd className="text-right">
                {fmt18(q.minOut, side === "buy" ? 2 : 6)} {outUnit}
              </dd>
              <dt>{t("trade.routerFee")}</dt>
              <dd className="text-right">{fmt18(q.fee, 6)} BNB</dd>
            </dl>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("trade.slippage")}>
            <input className={inputClass} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value.replace(/[^0-9.]/g, ""))} />
          </Field>
          <Field label={t("trade.deadline")}>
            <input className={inputClass} inputMode="numeric" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value.replace(/[^0-9]/g, ""))} />
          </Field>
        </div>
        {slipBps && slipBps > 500n ? <p className="font-medium text-down">{t("trade.highSlip")}</p> : null}
      </div>

      <div className="mt-6">
        <NeedsWallet why={t("trade.connectWhy")} agent={side}>
          {hasAgent === false ? (
            <p className="mb-3 text-sm font-medium text-muted">{t("trade.noRebate")}</p>
          ) : hasAgent ? (
            <p className="mb-3 text-sm font-medium text-sub">
              <Pill tone="neutral">{t("trade.agentPill")}</Pill> <span className="ml-1">{t("trade.agentNote")}</span>
            </p>
          ) : null}
          <>
            {overLimit ? <p className="mb-3 font-medium text-down">{t("trade.overLimit")}</p> : null}
            {insufficient ? <p className="mb-3 font-medium text-down">{t("trade.notEnough", { unit: inUnit })}</p> : null}
            <Button tone={side === "buy" ? "soft" : "gold"} size="lg" className="w-full" disabled={!ready || tx.busy} onClick={submit}>
              {tx.busy
                ? t("wallet.checkWallet")
                : side === "buy"
                  ? t("trade.buy")
                  : needsApproval
                    ? t("trade.approveSell")
                    : t("trade.sell")}
            </Button>
            {side === "sell" && needsApproval ? (
              <p className="mt-2 text-center text-[12.5px] text-muted">{t("trade.sellNote", { n: amountIn ? fmt18(amountIn, 2) : t("trade.the") })}</p>
            ) : null}
          </>
          <TxNotice state={tx.state} onClose={tx.reset} />
          <AgentPathToggle key={side} flow={side} className="mt-3" />
        </NeedsWallet>
      </div>
      <RiskLine className="mt-4" />
    </Panel>
  );
}

function FeeSplit() {
  const { t } = useLocale();
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">{t("trade.where")}</h2>
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        <div className="bg-gold" style={{ flex: 50 }} />
        <div className="bg-up" style={{ flex: 30 }} />
        <div className="bg-[#34406A]" style={{ flex: 20 }} />
      </div>
      <ul className="mt-4 space-y-2 font-medium">
        <li>
          <span className="font-mono text-[18px] font-medium text-gold">50%</span> {t("trade.split1")}
        </li>
        <li>
          <span className="font-mono text-[18px] font-medium text-up">30%</span> {t("trade.split2")}
        </li>
        <li>
          <span className="font-mono text-[18px] font-medium text-sub">20%</span> {t("trade.split3")}
        </li>
      </ul>
      <p className="mt-3 text-sm font-semibold text-sub">{t("trade.splitNote")}</p>
    </Panel>
  );
}

function LimitCard() {
  const { chainId, addresses, account } = useTowack();
  const router = addresses.router!;
  const now = useNow();
  const { t, rich } = useLocale();
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
      <h2 className="text-[20px] font-semibold tracking-tight">{t("trade.limitTitle")}</h2>
      <p className="mt-1 text-[14px] font-medium text-sub">
        {rich("trade.limitBody", { b: (c) => <b>{c}</b> })}
      </p>
      <div className="mt-5">
        <NeedsWallet>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t("trade.limit")} value={limit === undefined ? "—" : limit === maxUint256 ? t("trade.unlimited") : `${fmt18(limit)} BNB`} />
            <Stat label={t("trade.usedToday")} value={`${fmt18(spent)} BNB`} />
          </div>
          {hasPending ? (
            <p className="mt-3 rounded-2xl border border-line bg-gold/5 px-4 py-2 font-medium">
              {t("trade.pendingRaise", { v: pendingLimit === maxUint256 ? t("trade.unlimitedLower") : `${fmt18(pendingLimit)} BNB`, date: fmtDate(pendingAt) })}
            </p>
          ) : null}
          <div className="mt-4">
            <Field label={t("trade.newLimit")} hint={parsed !== undefined ? (isRaise ? t("trade.isRaise") : t("trade.isLower")) : undefined}>
              <input className={inputClass} inputMode="decimal" placeholder={t("trade.eg")} value={newLimit} onChange={(e) => setNewLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button tone="soft" size="sm" disabled={!parsed || tx.busy} onClick={() => parsed && set(parsed, t("trade.txSetLimit"))}>
              {t("trade.setLimit")}
            </Button>
            <Button tone="line" size="sm" disabled={tx.busy || limit === maxUint256} onClick={() => set(maxUint256, t("trade.txRemoveLimit"))}>
              {t("trade.removeLimit")}
            </Button>
          </div>
          <TxNotice state={tx.state} onClose={tx.reset} />
        </NeedsWallet>
      </div>
    </Panel>
  );
}
