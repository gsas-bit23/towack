"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { erc20Abi, formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { useBalance, useReadContract, useSendTransaction, useWriteContract } from "wagmi";
import { AgentPathToggle, type AgentSwapContext } from "@/components/AgentPath";
import { RiskLine } from "@/components/RiskNote";
import { ADDRESSES } from "@/config/addresses";
import { NeedsWallet, TxNotice } from "@/components/status";
import { Button, Pill } from "@/components/ui";
import { toMainnetToken } from "@/lib/agentSwap";
import { useTowack } from "@/lib/chain";
import {
  CHAIN_NAMES,
  executionPlan,
  isNative,
  isRelayTerminal,
  makeToken,
  ORIGIN_TOKENS,
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
import { PREVIEW_USER, useDebounced, useRoutes } from "./useRoutes";

const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 9'%3E%3Cpath d='M1 1l6 6 6-6' stroke='%23A1A8B3' stroke-width='2.2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
};
/** Token / chain picker: a compact pill, like the rest of the card. */
const pillSelect =
  "min-w-0 max-w-full shrink-0 cursor-pointer appearance-none rounded-full border border-line-2 bg-card bg-[length:11px] bg-[right_12px_center] bg-no-repeat py-2 pl-3.5 pr-8 font-semibold text-fg transition-colors hover:border-gold/50 focus:outline-none focus:ring-2 focus:ring-gold/40";
const bigInput = "w-full min-w-0 bg-transparent font-mono text-[30px] font-medium leading-tight text-fg placeholder:text-dim focus:outline-none";
const smallInput =
  "w-full rounded-xl border border-line-2 bg-card px-3 py-2 font-mono text-[15px] text-fg placeholder:text-dim focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25";
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

const eta = (s?: number) => (s === undefined ? "" : s < 60 ? `~${Math.max(1, s)}s` : `~${Math.round(s / 60)}m`);

const browserFetch: FetchLike = (url, init) => fetch(url, init);

export function SwapDesk() {
  return (
    <div className="mx-auto w-full max-w-[480px]">
      <SwapCard />
    </div>
  );
}

/** One rounded "You pay" / "You get" box. */
function AmountBox({ label, side, children }: { label: string; side?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-card-2 p-4">
      <div className="flex items-center justify-between gap-3 text-[13px] font-medium text-muted">
        <span>{label}</span>
        {side}
      </div>
      <div className="mt-2 flex items-center gap-3">{children}</div>
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
  const [showSettings, setShowSettings] = useState(false);
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
  const settingsProblem = slipBps === undefined || deadlineSec === undefined || slipLevel !== "ok";

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

  // Flip is a same-chain convenience: the received token becomes the paid one.
  const canFlip = !crossChain && originTokens.some((x) => sameToken(x, tokenOut));
  const flip = () => {
    if (!canFlip) return;
    setFromAddr(tokenOut.address);
    setToAddr(tokenIn.address);
    setAmount("");
    resetFlow();
  };

  const outAmount = selected ? fmtAmt(selected.amountOut, selected.tokenOut.decimals) : "";

  return (
    <div className="rounded-3xl border border-line bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between px-1 pb-3">
        <h2 className="text-[17px] font-semibold tracking-tight">{t("swap.cardTitle")}</h2>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
          aria-label={t("swap.settings")}
          className={`relative grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-card-2 hover:text-fg ${showSettings ? "bg-card-2 text-fg" : ""}`}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
          {settingsProblem && !showSettings ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-down" aria-hidden="true" /> : null}
        </button>
      </div>

      {showSettings ? (
        <div className="mb-3 grid grid-cols-2 gap-3 rounded-2xl bg-card-2 p-4">
          <label className="block text-[13px] font-medium text-muted">
            {t("trade.slippage")}
            <input className={`${smallInput} mt-1.5`} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={t("swap.slipAria")} />
          </label>
          <label className="block text-[13px] font-medium text-muted">
            {t("trade.deadline")}
            <input className={`${smallInput} mt-1.5`} inputMode="numeric" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value.replace(/[^0-9]/g, ""))} aria-label={t("swap.deadlineAria")} />
          </label>
        </div>
      ) : null}
      {slipBps === undefined ? <Note>{t("swap.slipRange")}</Note> : null}
      {slipLevel === "high" ? <Note>{t("swap.slipHigh")}</Note> : null}
      {slipLevel === "extreme" ? <Note>{t("swap.slipExtreme")}</Note> : null}
      {deadlineSec === undefined ? <Note>{t("swap.deadlineRange")}</Note> : null}

      <AmountBox
        label={t("swap.youPay")}
        side={
          account ? (
            <span className="flex items-center gap-2">
              {t("swap.balance", { n: fmtAmt(balance, tokenIn.decimals), sym: tokenIn.symbol })}
              <button
                type="button"
                disabled={!balance}
                onClick={() => balance && setAmount(formatUnits(isNative(tokenIn) ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance, tokenIn.decimals))}
                className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold uppercase text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                {t("common.max")}
              </button>
            </span>
          ) : undefined
        }
      >
        <input
          className={bigInput}
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value.replace(/[^0-9.]/g, ""));
            setPick(null);
          }}
          aria-label={t("swap.amountIn", { sym: tokenIn.symbol })}
        />
        <select
          aria-label={t("swap.tokenPay")}
          className={`${pillSelect} text-[16px]`}
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
      </AmountBox>

      <div className="relative z-10 -my-3 flex justify-center">
        <button
          type="button"
          onClick={flip}
          disabled={!canFlip}
          aria-label={t("swap.flip")}
          className="grid h-10 w-10 place-items-center rounded-xl border-4 border-card bg-card-2 text-sub transition-colors hover:text-fg disabled:cursor-default disabled:hover:text-sub"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </button>
      </div>

      <AmountBox
        label={t("swap.youGet")}
        side={
          <select
            aria-label={t("swap.destChain")}
            className={`${pillSelect} !py-1 text-[12.5px]`}
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
                {c.id === chainId ? c.name : t("swap.viaRelay", { name: c.name })}
              </option>
            ))}
          </select>
        }
      >
        <div className={`${bigInput.replace("text-fg", outAmount ? "text-fg" : "text-dim")} truncate`} aria-live="polite">
          {routes.isFetching && !result && amountIn ? <span className="animate-pulse text-dim">…</span> : outAmount || "0"}
        </div>
        <select
          aria-label={t("swap.tokenGet")}
          className={`${pillSelect} text-[16px]`}
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
      </AmountBox>

      {crossChain ? (
        <div className="mt-2">
          <input
            className={`${smallInput} !text-[13.5px]`}
            placeholder={t("swap.recipientPh", { chain: CHAIN_NAMES[destChainId] ?? "" })}
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value.trim())}
            aria-label={t("swap.recipientAria")}
            aria-invalid={recipientBad}
          />
          {recipientBad ? <Note>{t("swap.badAddr")}</Note> : null}
        </div>
      ) : null}

      <RouteSummary
        loading={routes.isFetching && !result}
        refreshing={routes.isFetching && Boolean(result)}
        result={result}
        selected={selected}
        onPick={(p) => setPick(p)}
        amountIn={amountIn}
        queryError={routes.error ? String(routes.error) : undefined}
        previewOnly={!account || result?.quotedFor === PREVIEW_USER}
      />

      <div className="mt-3">
        <NeedsWallet why={t("swap.connectWhy")}>
          {insufficient ? <Note>{t("swap.notEnough", { sym: tokenIn.symbol })}</Note> : null}
          {lowGasHeadroom ? <Note>{t("swap.lowGas", { sym: tokenIn.symbol })}</Note> : null}
          {selected && selected.provider === "relay" && selected.priceImpactPct !== undefined && selected.priceImpactPct < -3 ? (
            <Note>{t("swap.relayImpact", { p: Math.abs(selected.priceImpactPct).toFixed(2) })}</Note>
          ) : null}
          {selected && selected.vsBestBps < -100 ? <Note>{t("swap.vsBest", { p: (Math.abs(selected.vsBestBps) / 100).toFixed(2) })}</Note> : null}
          {selected && !builtForMe && account ? <p className="mb-2 text-sm font-medium text-sub">{t("swap.refreshing")}</p> : null}
          <Button tone="gold" size="lg" className="w-full !rounded-2xl" disabled={!ready} onClick={execute}>
            {tx.busy
              ? t("wallet.checkWallet")
              : !amountIn
                ? t("swap.enterAmountBtn")
                : !selected
                  ? t("swap.pickAmount")
                  : needsApproval
                    ? t("swap.approveThen", { sym: tokenIn.symbol, action: crossChain ? t("swap.actBridge") : t("swap.actSwap") })
                    : crossChain
                      ? t("swap.Bridge")
                      : t("swap.Swap")}
          </Button>
          {needsApproval && selected ? (
            <p className="mt-2 text-center text-[12.5px] text-muted">
              {t("swap.twoConfirm", { amt: amountIn ? fmtAmt(amountIn, tokenIn.decimals) : t("trade.the"), sym: tokenIn.symbol })}
            </p>
          ) : null}
          <TxNotice state={tx.state} onClose={tx.reset} />
          {relayReq ? <RelayTracker status={relayStatusQ.data?.status} error={relayStatusQ.error ? String(relayStatusQ.error) : undefined} dest={relayReq.dest} id={relayReq.id} /> : null}
        </NeedsWallet>
      </div>

      {twakPair ? (
        <p className="mt-3 text-center text-[13px] text-muted">
          {rich("swap.twakPair", {
            a: (c) => (
              <Link className="font-semibold text-fg underline decoration-1 underline-offset-2 hover:text-gold" href="/tokenomics">
                {c}
              </Link>
            ),
          })}
        </p>
      ) : null}
      <AgentPathToggle key={`${crossChain}-${selected?.provider ?? "none"}`} flow={crossChain ? "bridge" : "swap"} swap={agentCtx} className="mt-3" />
      <RiskLine className="mt-3" />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-1 px-1 text-[13px] font-medium text-down">{children}</p>;
}

/** Best route as one line; the others fold away (Jumper-style). */
function RouteSummary({
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
  const [open, setOpen] = useState(false);
  if (!amountIn) return null;
  if (loading) {
    return (
      <p className="mt-3 px-1 text-[13px] font-medium text-muted" role="status">
        {t("swap.asking")}
      </p>
    );
  }
  if (queryError) return <p className="mt-3 rounded-2xl bg-down/10 px-4 py-3 text-[13.5px] font-medium">{t("swap.quoteFailed", { e: queryError })}</p>;
  if (!result) return null;
  const { quotes } = result;
  if (quotes.length === 0) return <p className="mt-3 rounded-2xl bg-down/10 px-4 py-3 text-[13.5px] font-medium">{t("swap.noRoute")}</p>;
  if (!selected) return null;
  const others = quotes.length - 1;
  return (
    <div className="mt-3 rounded-2xl border border-line px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-medium text-fg">
          <a className="font-semibold underline decoration-1 underline-offset-2 hover:text-gold" href={PROVIDER_SITE[selected.provider]} target="_blank" rel="noreferrer">
            {selected.label}
          </a>
          {selected.best ? <Pill tone="gold">{t("swap.best")}</Pill> : null}
        </span>
        <span className="text-muted">
          {t("swap.gas", { n: fmtAmt(selected.gasCostWei, 18, 3), unit: selected.tokenIn.chainId === 97 ? "tBNB" : "BNB" })}
          {selected.etaSeconds !== undefined ? ` · ${eta(selected.etaSeconds)}` : ""}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted">
        <span>{t("swap.min", { n: fmtAmt(selected.minAmountOut, selected.tokenOut.decimals), sym: selected.tokenOut.symbol })}</span>
        <span>{refreshing ? t("swap.refreshingShort") : previewOnly ? t("swap.previewQuotes") : ""}</span>
      </div>
      {others > 0 ? (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 font-semibold text-sub hover:text-fg">
            {open ? t("swap.hideRoutes") : t("swap.moreRoutes", { n: others })}
          </button>
          {open ? (
            <ul className="mt-2 space-y-1.5" role="radiogroup" aria-label={t("swap.routesAria")}>
              {quotes.map((q) => {
                const on = selected.provider === q.provider;
                return (
                  <li key={q.provider}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onPick(q.provider)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${on ? "bg-card-2 text-fg" : "text-sub hover:bg-card-2"}`}
                    >
                      <span className="font-semibold">{q.label}</span>
                      <span className="font-mono tabular-nums">
                        {fmtAmt(q.amountOut, q.tokenOut.decimals)} {q.tokenOut.symbol}
                        {!q.best ? <span className="ml-2 text-dim">{(q.vsBestBps / 100).toFixed(2)}%</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RelayTracker({ status, error, dest, id }: { status?: string; error?: string; dest: string; id: string }) {
  const done = status === "success";
  const bad = status === "failure" || status === "refund" || status === "refunded";
  const { t } = useLocale();
  return (
    <div role="status" aria-live="polite" className={`mt-3 rounded-2xl border border-line px-4 py-3 text-[13.5px] font-medium ${done ? "bg-card" : bad ? "bg-down/10" : "bg-card-2"}`}>
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
