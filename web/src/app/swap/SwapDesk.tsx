"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { useBalance, useReadContract, useSendTransaction, useWriteContract } from "wagmi";
import { agentIdAbi } from "@/abi";
import { AgentPathToggle, type AgentSwapContext } from "@/components/AgentPath";
import { ADDRESSES } from "@/config/addresses";
import { ChainNote, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, inputClass } from "@/components/ui";
import { toMainnetToken } from "@/lib/agentSwap";
import { useTowack } from "@/lib/chain";
import {
  CHAIN_NAMES,
  executionPlan,
  isNative,
  isRelayTerminal,
  makeToken,
  ORIGIN_TOKENS,
  PROVIDER_LABEL,
  PROVIDER_SITE,
  RELAY_DESTINATIONS,
  relayStatus,
  sameToken,
  slippageWarning,
  type FetchLike,
  type ProviderId,
  type ScoredQuote,
  type Token,
} from "@/lib/quotes";
import { useTx } from "@/lib/tx";
import { useLocale } from "@/lib/i18n";
import { PREVIEW_USER, PROVIDER_KEYS_SET, useDebounced, useRoutes } from "./useRoutes";

const selectClass =
  "w-full min-w-0 appearance-none rounded-2xl border border-line bg-card bg-[length:14px] bg-[right_14px_center] bg-no-repeat px-4 py-3 pr-10 font-display text-[18px] font-semibold text-fg focus:outline-none focus:ring-4 focus:ring-gold/40";
const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 9'%3E%3Cpath d='M1 1l6 6 6-6' stroke='%2313204A' stroke-width='2.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
};
const GAS_RESERVE = 2n * 10n ** 15n; // keep 0.002 BNB for gas when "Max" is used on native BNB

function fmtAmt(v: bigint | undefined, decimals: number, sig = 6): string {
  if (v === undefined) return "—";
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: Math.max(2, sig - Math.floor(Math.log10(n)) - 1) });
  return n.toLocaleString("en-US", { maximumSignificantDigits: sig });
}

function safeUnits(v: string, decimals: number): bigint | undefined {
  const s = v.trim();
  if (!s || s === ".") return undefined;
  try {
    const x = parseUnits(s as `${number}`, decimals);
    return x > 0n ? x : undefined;
  } catch {
    return undefined;
  }
}

const browserFetch: FetchLike = (url, init) => fetch(url, init);

export function SwapDesk() {
  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 lg:col-span-7">
        <SwapCard />
      </div>
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <HowRouting />
        <ProvidersPanel />
        <TwakDeskCard />
      </div>
    </div>
  );
}

function SwapCard() {
  const { chainId, addresses, account } = useTowack();
  const { t, rich } = useLocale();
  const twak = addresses.token ? makeToken(chainId, addresses.token, "TWAK", "Towack") : undefined;
  const originTokens = [...ORIGIN_TOKENS[chainId], ...(twak ? [twak] : [])];
  const destChains = [{ id: 56, name: CHAIN_NAMES[56] }, ...RELAY_DESTINATIONS.map((c) => ({ id: c.id, name: c.name }))];

  const [fromAddr, setFromAddr] = useState<string>("");
  const [toChain, setToChain] = useState<number>(0);
  const [toAddr, setToAddr] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [deadlineMin, setDeadlineMin] = useState("10");
  const [recipientInput, setRecipientInput] = useState("");
  const [pick, setPick] = useState<ProviderId | null>(null);
  const [relayReq, setRelayReq] = useState<{ id: string; dest: string } | null>(null);

  // Derived selections fall back to sane defaults whenever the network flips (no effects needed).
  const tokenIn = originTokens.find((t) => t.address === fromAddr) ?? originTokens[0];
  const destChainId = destChains.some((c) => c.id === toChain) ? toChain : chainId;
  const crossChain = destChainId !== chainId;
  const destTokens: Token[] = crossChain ? (RELAY_DESTINATIONS.find((c) => c.id === destChainId)?.tokens ?? []) : originTokens.filter((t) => !sameToken(t, tokenIn));
  const tokenOut = destTokens.find((t) => t.address === toAddr) ?? destTokens[0];

  const amountIn = safeUnits(amount, tokenIn.decimals);
  const slipNum = Number(slippage);
  const slipBps = Number.isFinite(slipNum) && slipNum >= 0.05 && slipNum <= 50 ? Math.round(slipNum * 100) : undefined;
  const slipLevel = slipBps === undefined ? "ok" : slippageWarning(slipBps);
  const deadlineSec = (() => {
    const m = Number(deadlineMin);
    return Number.isFinite(m) && m >= 1 && m <= 60 ? Math.round(m * 60) : undefined;
  })();
  const recipientTrim = recipientInput.trim();
  const recipientBad = crossChain && recipientTrim !== "" && !isAddress(recipientTrim);
  const recipient = crossChain && recipientTrim && isAddress(recipientTrim) ? getAddress(recipientTrim) : undefined;

  const tx = useTx();
  const debAmount = useDebounced(amountIn);
  const routes = useRoutes({
    chainId,
    tokenIn,
    tokenOut,
    amountIn: debAmount,
    slippageBps: slipBps,
    account,
    recipient,
    paused: tx.busy,
  });
  const result = routes.data && debAmount === amountIn ? routes.data : undefined;
  const quotes = result?.quotes ?? [];
  const selected: ScoredQuote | undefined = quotes.find((q) => q.provider === pick) ?? quotes[0];

  // Balances / allowance for the selected route.
  const { data: nativeBal } = useBalance({ address: account, chainId, query: { enabled: Boolean(account) } });
  const { data: tokenBal } = useReadContract({
    address: isNative(tokenIn) ? undefined : tokenIn.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(account && !isNative(tokenIn)) },
  });
  const balance = isNative(tokenIn) ? nativeBal?.value : tokenBal;
  const approval = selected?.approval;
  const { data: allowance } = useReadContract({
    address: approval?.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && approval ? [account, approval.spender] : undefined,
    chainId,
    query: { enabled: Boolean(account && approval) },
  });
  const needsApproval = Boolean(approval && (allowance === undefined || allowance < approval.amount));

  const { data: agentBal } = useReadContract({
    address: addresses.agentId,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(addresses.agentId && account) },
  });
  const hasAgent = agentBal === undefined ? undefined : agentBal > 0n;

  const relayStatusQ = useQuery({
    queryKey: ["relay-status", relayReq?.id],
    enabled: Boolean(relayReq),
    refetchInterval: (q) => (q.state.data && isRelayTerminal(q.state.data.status) ? false : 4_000),
    queryFn: () => relayStatus(relayReq!.id, browserFetch),
  });

  const insufficient = amountIn !== undefined && balance !== undefined && amountIn > balance;
  const lowGasHeadroom = isNative(tokenIn) && amountIn !== undefined && balance !== undefined && !insufficient && balance - amountIn < GAS_RESERVE;
  const builtForMe = selected ? Boolean(selected.amm) || (account !== undefined && result?.quotedFor === account) : false;
  const ready = Boolean(account && selected && slipBps && deadlineSec && slipLevel !== "extreme" && !insufficient && !recipientBad && builtForMe && !tx.busy);
  const twakPair = tokenIn.symbol === "TWAK" || tokenOut?.symbol === "TWAK";

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  async function execute() {
    if (!ready || !selected || !account) return;
    const q = selected; // snapshot: refreshes are paused while the wallet is busy
    const plan = executionPlan(q, { recipient: account, nowSec: Date.now() / 1000, deadlineSec, allowance });
    if (plan.approval) {
      const ap = plan.approval;
      const ok = await tx.run(t("swap.txApprove", { amt: fmtAmt(ap.amount, q.tokenIn.decimals), sym: q.tokenIn.symbol }), () =>
        writeContractAsync({ address: ap.token, abi: erc20Abi, functionName: "approve", args: [ap.spender, ap.amount], chainId }),
      );
      if (!ok) return;
    }
    // AMM calldata is rebuilt after an approval so the deadline is fresh.
    const txs = plan.approval && q.amm ? executionPlan(q, { recipient: account, nowSec: Date.now() / 1000, deadlineSec, allowance: q.approval?.amount }).txs : plan.txs;
    for (let i = 0; i < txs.length; i++) {
      const step = txs[i];
      const label = `${t("swap.via", { action: q.crossChain ? t("swap.Bridge") : t("swap.Swap"), label: q.label })}${txs.length > 1 ? ` (${i + 1}/${txs.length})` : ""}`;
      const ok = await tx.run(label, () => sendTransactionAsync({ to: step.to, data: step.data, value: step.value, chainId }));
      if (!ok) return;
    }
    if (q.provider === "relay" && q.relayRequestId) setRelayReq({ id: q.relayRequestId, dest: CHAIN_NAMES[q.tokenOut.chainId] ?? "destination" });
  }

  // Agent instructions always describe the MAINNET equivalent of the route.
  const agentCtx: AgentSwapContext = (() => {
    if (!tokenOut || !amountIn || !slipBps) return {};
    const i = toMainnetToken(tokenIn, ADDRESSES[56].token);
    const o = toMainnetToken(tokenOut, ADDRESSES[56].token);
    const plan = selected?.amm;
    return {
      route: {
        provider: selected?.provider ?? (crossChain ? "relay" : "pancakeV3"),
        tokenIn: i.token,
        tokenOut: o.token,
        amountIn,
        slippageBps: slipBps,
        v3Fee: plan?.kind === "v3" ? plan.fee : undefined,
        v2ViaWbnb: plan?.kind === "v2" ? plan.path.length === 3 : undefined,
        routeText: selected ? `${selected.label}: ${selected.route}` : undefined,
      },
      inPlaceholder: i.placeholder,
      outPlaceholder: o.placeholder,
    };
  })();

  const resetFlow = () => {
    tx.reset();
    setRelayReq(null);
    setPick(null);
  };

  if (!tokenOut) return null;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[21px] font-semibold tracking-tight">{t("swap.cardTitle")}</h2>
        <ChainNote />
      </div>

      <div className="mt-6 space-y-5">
        <Field label={t("swap.youPay")} hint={account ? t("swap.balance", { n: fmtAmt(balance, tokenIn.decimals), sym: tokenIn.symbol }) : undefined}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
            <select
              aria-label={t("swap.tokenPay")}
              className={`${selectClass} col-span-2 sm:col-span-1`}
              style={CHEVRON}
              value={tokenIn.address}
              onChange={(e) => {
                setFromAddr(e.target.value);
                setAmount("");
                resetFlow();
              }}
            >
              {originTokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                setPick(null);
              }}
              aria-label={t("swap.amountIn", { sym: tokenIn.symbol })}
            />
            <Button
              tone="line"
              size="sm"
              disabled={!balance}
              onClick={() => balance && setAmount(formatUnits(isNative(tokenIn) ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance, tokenIn.decimals))}
            >
              {t("common.max")}
            </Button>
          </div>
        </Field>

        <Field label={t("swap.youGet")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              aria-label={t("swap.destChain")}
              className={selectClass}
              style={CHEVRON}
              value={destChainId}
              onChange={(e) => {
                setToChain(Number(e.target.value));
                setToAddr("");
                resetFlow();
              }}
            >
              {destChains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === chainId ? t("swap.sameChain", { name: c.name }) : t("swap.viaRelay", { name: c.name })}
                </option>
              ))}
            </select>
            <select
              aria-label={t("swap.tokenGet")}
              className={selectClass}
              style={CHEVRON}
              value={tokenOut.address}
              onChange={(e) => {
                setToAddr(e.target.value);
                resetFlow();
              }}
            >
              {destTokens.map((t) => (
                <option key={`${t.chainId}-${t.address}`} value={t.address}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
        </Field>

        {crossChain ? (
          <Field label={t("swap.recipient")} hint={t("swap.recipientHint", { chain: CHAIN_NAMES[destChainId] ?? "" })}>
            <input
              className={`${inputClass} font-mono !text-[15px]`}
              placeholder={account ?? t("swap.recipientPh")}
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value.trim())}
              aria-label={t("swap.recipientAria")}
              aria-invalid={recipientBad}
            />
          </Field>
        ) : null}
        {recipientBad ? <p className="font-medium text-down">{t("swap.badAddr")}</p> : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("trade.slippage")} hint={t("swap.slipHint")}>
            <input className={inputClass} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={t("swap.slipAria")} />
          </Field>
          <Field label={t("trade.deadline")} hint={t("swap.deadlineHint")}>
            <input className={inputClass} inputMode="numeric" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value.replace(/[^0-9]/g, ""))} aria-label={t("swap.deadlineAria")} />
          </Field>
        </div>
        {slipBps === undefined ? <p className="font-medium text-down">{t("swap.slipRange")}</p> : null}
        {slipLevel === "high" ? <p className="font-medium text-down">{t("swap.slipHigh")}</p> : null}
        {slipLevel === "extreme" ? <p className="font-medium text-down">{t("swap.slipExtreme")}</p> : null}
        {deadlineSec === undefined ? <p className="font-medium text-down">{t("swap.deadlineRange")}</p> : null}
      </div>

      <RouteList
        loading={routes.isFetching && !result}
        refreshing={routes.isFetching && Boolean(result)}
        result={result}
        selected={selected}
        onPick={(p) => setPick(p)}
        amountIn={amountIn}
        queryError={routes.error ? String(routes.error) : undefined}
        previewOnly={!account || result?.quotedFor === PREVIEW_USER}
      />

      {twakPair ? (
        <p className="mt-5 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
          {rich("swap.twakPair", {
            a: (c) => (
              <Link className="underline" href="/trade">
                {c}
              </Link>
            ),
          })}
        </p>
      ) : null}

      <div className="mt-6">
        <NeedsWallet why={t("swap.connectWhy")}>
          {hasAgent ? (
            <p className="mb-4 text-sm font-medium text-sub">
              <Pill tone="neutral">{t("trade.agentPill")}</Pill> <span className="ml-1">{t("swap.agentNote")}</span>
            </p>
          ) : null}
          <>
            {insufficient ? <p className="mb-3 font-medium text-down">{t("swap.notEnough", { sym: tokenIn.symbol })}</p> : null}
            {lowGasHeadroom ? <p className="mb-3 font-medium text-down">{t("swap.lowGas", { sym: tokenIn.symbol })}</p> : null}
            {selected && selected.provider === "relay" && selected.priceImpactPct !== undefined && selected.priceImpactPct < -3 ? (
              <p className="mb-3 font-medium text-down">{t("swap.relayImpact", { p: Math.abs(selected.priceImpactPct).toFixed(2) })}</p>
            ) : null}
            {selected && selected.vsBestBps < -100 ? (
              <p className="mb-3 font-medium text-down">{t("swap.vsBest", { p: (Math.abs(selected.vsBestBps) / 100).toFixed(2) })}</p>
            ) : null}
            {selected && !builtForMe && account ? <p className="mb-3 font-medium text-sub">{t("swap.refreshing")}</p> : null}
            <Button tone={crossChain ? "gold" : "soft"} size="lg" className="w-full" disabled={!ready} onClick={execute}>
              {tx.busy
                ? t("wallet.checkWallet")
                : !selected
                  ? t("swap.pickAmount")
                  : needsApproval
                    ? t("swap.approveThen", { sym: tokenIn.symbol, action: crossChain ? t("swap.actBridge") : t("swap.actSwap") })
                    : t("swap.via", { action: crossChain ? t("swap.Bridge") : t("swap.Swap"), label: selected.label })}
            </Button>
            <p className="mt-3 text-center text-sm font-medium text-muted">
              {needsApproval
                ? t("swap.twoConfirm", {
                    amt: amountIn ? fmtAmt(amountIn, tokenIn.decimals) : t("trade.the"),
                    sym: tokenIn.symbol,
                    label: selected?.label ?? "",
                    action: crossChain ? t("swap.actBridge") : t("swap.actSwap"),
                  })
                : t("swap.confirmAll")}
            </p>
          </>
          <TxNotice state={tx.state} onClose={tx.reset} />
          {relayReq ? <RelayTracker status={relayStatusQ.data?.status} error={relayStatusQ.error ? String(relayStatusQ.error) : undefined} dest={relayReq.dest} id={relayReq.id} /> : null}
        </NeedsWallet>
        <AgentPathToggle key={`${crossChain}-${selected?.provider ?? "none"}`} flow={crossChain ? "bridge" : "swap"} swap={agentCtx} className="mt-4" />
      </div>
      <p className="mt-6 text-sm font-semibold text-muted">
        {t("swap.estimates")}
      </p>
    </Panel>
  );
}

function RouteList({
  loading,
  refreshing,
  result,
  selected,
  onPick,
  amountIn,
  queryError,
  previewOnly,
}: {
  loading: boolean;
  refreshing: boolean;
  result?: { quotes: ScoredQuote[]; errors: { provider: ProviderId; label: string; error: string }[] };
  selected?: ScoredQuote;
  onPick: (p: ProviderId) => void;
  amountIn?: bigint;
  queryError?: string;
  previewOnly: boolean;
}) {
  const { t } = useLocale();
  if (!amountIn) {
    return <p className="mt-6 rounded-2xl border border-dashed border-line bg-card-2 px-5 py-4 font-medium text-sub">{t("swap.enterAmount")}</p>;
  }
  if (loading) {
    return (
      <p className="mt-6 rounded-2xl border border-line bg-card-2 px-5 py-4 font-medium" role="status">
        {t("swap.asking")}
      </p>
    );
  }
  if (queryError) return <p className="mt-6 rounded-2xl border border-line bg-down/10 px-5 py-4 font-medium">{t("swap.quoteFailed", { e: queryError })}</p>;
  if (!result) return null;
  const { quotes, errors } = result;
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-widest text-muted">{t("swap.routes", { n: quotes.length })}</h3>
        <span className="text-xs font-medium text-muted">{refreshing ? t("swap.refreshingShort") : previewOnly ? t("swap.previewQuotes") : t("swap.liveQuotes")}</span>
      </div>
      {quotes.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-line bg-down/10 px-5 py-4 font-medium">{t("swap.noRoute")}</p>
      ) : (
        <ul className="mt-2 space-y-3" role="radiogroup" aria-label={t("swap.routesAria")}>
          {quotes.map((q) => {
            const on = selected?.provider === q.provider;
            return (
              <li key={q.provider}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onPick(q.provider)}
                  className={`w-full rounded-2xl border border-line p-4 text-left transition ${on ? "bg-card-2" : "bg-card hover:bg-card-2"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line ${on ? "bg-card-2" : "bg-card"}`} aria-hidden="true">
                      {on ? <span className="h-2 w-2 rounded-full bg-card" /> : null}
                    </span>
                    <span className="font-display text-[18px] font-semibold">{q.label}</span>
                    {q.best ? <Pill tone="gold">{t("swap.best")}</Pill> : null}
                    {q.crossChain ? <Pill tone="gold">{t("swap.crossChain")}</Pill> : null}
                    <span className="ml-auto font-mono text-[18px] font-medium tabular-nums">
                      {fmtAmt(q.amountOut, q.tokenOut.decimals)} {q.tokenOut.symbol}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm font-medium text-sub sm:grid-cols-2">
                    <span className="break-words">{q.route}</span>
                    <span className="sm:text-right">
                      {t("swap.min", { n: fmtAmt(q.minAmountOut, q.tokenOut.decimals), sym: q.tokenOut.symbol })}
                    </span>
                    <span>
                      {t("swap.gas", { n: fmtAmt(q.gasCostWei, 18, 3), unit: q.tokenIn.chainId === 97 ? "tBNB" : "BNB" })}
                      {q.gasScored && q.gasInOut > 0n ? ` (${fmtAmt(q.gasInOut, q.tokenOut.decimals, 3)} ${q.tokenOut.symbol})` : ""}
                    </span>
                    <span className="sm:text-right">
                      {q.best ? t("swap.bestNet") : t("swap.vsBestShort", { p: (q.vsBestBps / 100).toFixed(2) })}
                      {q.etaSeconds !== undefined ? ` · ~${q.etaSeconds < 60 ? `${Math.max(1, q.etaSeconds)}s` : `${Math.round(q.etaSeconds / 60)}m`}` : ""}
                    </span>
                    {q.feeNote ? <span className="sm:col-span-2">{q.feeNote}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {errors.length > 0 ? (
        <details className="mt-3 text-sm font-medium text-muted">
          <summary className="cursor-pointer">
            {t("swap.noQuoteCount", { n: errors.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {errors.map((e) => (
              <li key={e.provider} className="break-words">
                {e.label}: {e.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {selected ? (
        <p className="mt-3 text-xs font-medium text-muted">
          {t("swap.selected", { label: selected.label })}{" "}
          <a className="underline" href={PROVIDER_SITE[selected.provider]} target="_blank" rel="noreferrer">
            {PROVIDER_SITE[selected.provider].replace("https://", "")}
          </a>
        </p>
      ) : null}
    </div>
  );
}

function RelayTracker({ status, error, dest, id }: { status?: string; error?: string; dest: string; id: string }) {
  const done = status === "success";
  const bad = status === "failure" || status === "refund" || status === "refunded";
  const { t } = useLocale();
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-2xl border border-line px-4 py-3 font-medium ${done ? "bg-card" : bad ? "bg-down/10" : "bg-card-2"}`}>
      <span className="font-semibold">{t("swap.relay")}</span>
      {error
        ? t("swap.relayErr", { e: error })
        : done
          ? t("swap.relayDone", { dest })
          : bad
            ? t("swap.relayBad", { s: status ?? "" })
            : t("swap.relayWait", { dest, s: status ?? t("swap.checking") })}
      <a className="ml-2 underline" href={`https://relay.link/transaction/${id}`} target="_blank" rel="noreferrer">
        {t("swap.track")}
      </a>
    </div>
  );
}

function HowRouting() {
  const { t, rich } = useLocale();
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">{t("swap.howTitle")}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 font-medium text-sub">
        <li>{t("swap.how1")}</li>
        <li>{rich("swap.how2", { b: (c) => <b>{c}</b> })}</li>
        <li>{t("swap.how3")}</li>
        <li>{t("swap.how4")}</li>
      </ol>
    </Panel>
  );
}

function ProvidersPanel() {
  // Providers that are switched off are simply not listed.
  const { t } = useLocale();
  const rows: { id: ProviderId; what: string; on: boolean }[] = [
    { id: "pancakeV3", what: t("swap.pv.v3"), on: true },
    { id: "pancakeV2", what: t("swap.pv.v2"), on: true },
    { id: "uniswapV3", what: t("swap.pv.v3"), on: true },
    { id: "relay", what: t("swap.pv.relay"), on: true },
    { id: "zeroex", what: t("swap.pv.agg"), on: PROVIDER_KEYS_SET.zeroex },
    { id: "oneinch", what: t("swap.pv.agg"), on: PROVIDER_KEYS_SET.oneinch },
  ];
  return (
    <Panel>
      <h2 className="text-[20px] font-semibold tracking-tight">{t("swap.providers")}</h2>
      <ul className="mt-4 space-y-3">
        {rows.filter((r) => r.on).map((r) => (
          <li key={r.id} className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-3 sm:gap-y-1.5">
            <div className="min-w-0">
              <a className="font-display text-[17px] font-semibold underline decoration-2 underline-offset-2" href={PROVIDER_SITE[r.id]} target="_blank" rel="noreferrer">
                {PROVIDER_LABEL[r.id]}
              </a>
              <div className="text-sm font-medium text-muted">{r.what}</div>
            </div>
            <span className="max-w-full rounded-2xl bg-card-2 px-3 py-1 text-left text-xs font-semibold text-fg sm:text-right">{t("swap.pv.live")}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TwakDeskCard() {
  const { t } = useLocale();
  return (
    <Panel tone="gold" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">{t("swap.twakTitle")}</h2>
      <p className="mt-2 font-medium text-sub">{t("swap.twakBody")}</p>
      <div className="mt-4">
        <Link href="/trade" className="font-display text-[17px] font-semibold underline decoration-[3px] underline-offset-4 hover:text-gold">
          {t("swap.twakLink")}
        </Link>
      </div>
    </Panel>
  );
}
