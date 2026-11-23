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
  const { chainId, addresses, account, meta } = useTowack();
  const twak = addresses.token ? makeToken(chainId, addresses.token, "TWAK", "Towack") : undefined;
  const originTokens = [...ORIGIN_TOKENS[chainId], ...(twak ? [twak] : [])];
  const destChains = chainId === 56 ? [{ id: 56, name: CHAIN_NAMES[56] }, ...RELAY_DESTINATIONS.map((c) => ({ id: c.id, name: c.name }))] : [{ id: chainId, name: meta.name }];

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
      const ok = await tx.run(`Approve exactly ${fmtAmt(ap.amount, q.tokenIn.decimals)} ${q.tokenIn.symbol}`, () =>
        writeContractAsync({ address: ap.token, abi: erc20Abi, functionName: "approve", args: [ap.spender, ap.amount], chainId }),
      );
      if (!ok) return;
    }
    // AMM calldata is rebuilt after an approval so the deadline is fresh.
    const txs = plan.approval && q.amm ? executionPlan(q, { recipient: account, nowSec: Date.now() / 1000, deadlineSec, allowance: q.approval?.amount }).txs : plan.txs;
    for (let i = 0; i < txs.length; i++) {
      const t = txs[i];
      const label = `${q.crossChain ? "Bridge" : "Swap"} via ${q.label}${txs.length > 1 ? ` (${i + 1}/${txs.length})` : ""}`;
      const ok = await tx.run(label, () => sendTransactionAsync({ to: t.to, data: t.data, value: t.value, chainId }));
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
        <h2 className="text-[21px] font-semibold tracking-tight">Swap &amp; bridge</h2>
        <ChainNote />
      </div>

      <div className="mt-6 space-y-5">
        <Field label="You pay" hint={account ? `Balance: ${fmtAmt(balance, tokenIn.decimals)} ${tokenIn.symbol}` : undefined}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
            <select
              aria-label="Token you pay"
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
              aria-label={`Amount in ${tokenIn.symbol}`}
            />
            <Button
              tone="line"
              size="sm"
              disabled={!balance}
              onClick={() => balance && setAmount(formatUnits(isNative(tokenIn) ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance, tokenIn.decimals))}
            >
              Max
            </Button>
          </div>
        </Field>

        <Field label="You get">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              aria-label="Destination chain"
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
                  {c.id === chainId ? `${c.name} (same chain)` : `${c.name} · via Relay`}
                </option>
              ))}
            </select>
            <select
              aria-label="Token you get"
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

        {meta.testnet ? (
          <p className="rounded-2xl border border-line bg-card-2 px-4 py-3 text-sm font-medium">
            Testnet: only PancakeSwap (v2 + v3) has BSC-testnet pools. Relay cross-chain and Uniswap are mainnet-only, and test pools are thin, so quotes can
            look odd. Switch the network toggle to Mainnet to compare real Relay / Uniswap quotes (you can view without signing anything).
          </p>
        ) : null}

        {crossChain ? (
          <Field label="Recipient on destination (optional)" hint={`Defaults to your connected wallet. Must be an address you control on ${CHAIN_NAMES[destChainId]}.`}>
            <input
              className={`${inputClass} font-mono !text-[15px]`}
              placeholder={account ?? "0x… (your wallet)"}
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value.trim())}
              aria-label="Recipient address"
              aria-invalid={recipientBad}
            />
          </Field>
        ) : null}
        {recipientBad ? <p className="font-medium text-down">That is not a valid EVM address.</p> : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Slippage %" hint="Default 0.5%.">
            <input className={inputClass} inputMode="decimal" value={slippage} onChange={(e) => setSlippage(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Slippage percent" />
          </Field>
          <Field label="Deadline (min)" hint="1–60. PancakeSwap / Uniswap.">
            <input className={inputClass} inputMode="numeric" value={deadlineMin} onChange={(e) => setDeadlineMin(e.target.value.replace(/[^0-9]/g, ""))} aria-label="Deadline minutes" />
          </Field>
        </div>
        {slipBps === undefined ? <p className="font-medium text-down">Slippage must be between 0.05% and 50%.</p> : null}
        {slipLevel === "high" ? <p className="font-medium text-down">High slippage: you may get a much worse price, and bots can take the difference.</p> : null}
        {slipLevel === "extreme" ? <p className="font-medium text-down">Slippage above 15% is blocked here. Lower it to continue.</p> : null}
        {deadlineSec === undefined ? <p className="font-medium text-down">Deadline must be 1–60 minutes.</p> : null}
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
          Trading TWAK ⇄ BNB? The <Link className="underline" href="/trade">Towack desk</Link> routes through TowackRouter, where Agent ID wallets earn rebates.
          Routes on this page go straight to PancakeSwap / Uniswap / Relay and earn no Towack rebate.
        </p>
      ) : null}

      <div className="mt-6">
        <NeedsWallet why="Connect any wallet to swap or bridge. You sign every step in your own wallet.">
          {hasAgent ? (
            <p className="mb-4 text-sm font-medium text-sub">
              <Pill tone="neutral">AGENT ID ✓</Pill>{" "}
              <span className="ml-1">Use the AI-agent box below to run this route from your Binance Agentic Wallet. Third-party routes earn no Towack rebate.</span>
            </p>
          ) : null}
          <>
            {insufficient ? <p className="mb-3 font-medium text-down">Not enough {tokenIn.symbol} in this wallet.</p> : null}
            {lowGasHeadroom ? <p className="mb-3 font-medium text-down">This leaves almost no {tokenIn.symbol} for gas. Try a slightly smaller amount.</p> : null}
            {selected && selected.provider === "relay" && selected.priceImpactPct !== undefined && selected.priceImpactPct < -3 ? (
              <p className="mb-3 font-medium text-down">Relay reports a {Math.abs(selected.priceImpactPct).toFixed(2)}% total impact on this route. Check it is worth it.</p>
            ) : null}
            {selected && selected.vsBestBps < -100 ? (
              <p className="mb-3 font-medium text-down">This route pays {(Math.abs(selected.vsBestBps) / 100).toFixed(2)}% less than the best one.</p>
            ) : null}
            {selected && !builtForMe && account ? <p className="mb-3 font-medium text-sub">Refreshing the quote for your wallet…</p> : null}
            <Button tone={crossChain ? "gold" : "soft"} size="lg" className="w-full" disabled={!ready} onClick={execute}>
              {tx.busy
                ? "Check your wallet…"
                : !selected
                  ? "Pick an amount for a quote"
                  : needsApproval
                    ? `Approve exact ${tokenIn.symbol}, then ${crossChain ? "bridge" : "swap"}`
                    : `${crossChain ? "Bridge" : "Swap"} via ${selected.label}`}
            </Button>
            <p className="mt-3 text-center text-sm font-medium text-muted">
              {needsApproval
                ? `Two wallet confirmations: an approval for exactly ${amountIn ? fmtAmt(amountIn, tokenIn.decimals) : "the"} ${tokenIn.symbol} to the ${selected?.label} contract, then the ${crossChain ? "bridge" : "swap"}. Never unlimited.`
                : "You confirm every step in your own wallet. Towack never signs, holds or relays your funds."}
            </p>
          </>
          <TxNotice state={tx.state} onClose={tx.reset} />
          {relayReq ? <RelayTracker status={relayStatusQ.data?.status} error={relayStatusQ.error ? String(relayStatusQ.error) : undefined} dest={relayReq.dest} id={relayReq.id} /> : null}
        </NeedsWallet>
        <AgentPathToggle key={`${crossChain}-${selected?.provider ?? "none"}`} flow={crossChain ? "bridge" : "swap"} swap={agentCtx} className="mt-4" />
      </div>
      <p className="mt-6 text-sm font-semibold text-muted">
        Quotes are estimates and refresh every 20 seconds. Prices move; bridges take time. Towack is not affiliated with Relay, PancakeSwap, Uniswap, 0x or 1inch.
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
  if (!amountIn) {
    return <p className="mt-6 rounded-2xl border border-dashed border-line bg-card-2 px-5 py-4 font-medium text-sub">Enter an amount to compare routes.</p>;
  }
  if (loading) {
    return (
      <p className="mt-6 rounded-2xl border border-line bg-card-2 px-5 py-4 font-medium" role="status">
        Asking PancakeSwap, Uniswap and Relay…
      </p>
    );
  }
  if (queryError) return <p className="mt-6 rounded-2xl border border-line bg-down/10 px-5 py-4 font-medium">Quote failed: {queryError}</p>;
  if (!result) return null;
  const { quotes, errors } = result;
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-widest text-muted">Routes ({quotes.length})</h3>
        <span className="text-xs font-medium text-muted">{refreshing ? "Refreshing…" : previewOnly ? "Preview quotes · connect to execute" : "Live quotes"}</span>
      </div>
      {quotes.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-line bg-down/10 px-5 py-4 font-medium">No route found for this pair and amount. Try a different amount or token.</p>
      ) : (
        <ul className="mt-2 space-y-3" role="radiogroup" aria-label="Routes">
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
                    {q.best ? <Pill tone="gold">BEST</Pill> : null}
                    {q.crossChain ? <Pill tone="gold">CROSS-CHAIN</Pill> : null}
                    <span className="ml-auto font-mono text-[18px] font-medium tabular-nums">
                      {fmtAmt(q.amountOut, q.tokenOut.decimals)} {q.tokenOut.symbol}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm font-medium text-sub sm:grid-cols-2">
                    <span className="break-words">{q.route}</span>
                    <span className="sm:text-right">
                      Min {fmtAmt(q.minAmountOut, q.tokenOut.decimals)} {q.tokenOut.symbol}
                    </span>
                    <span>
                      Gas ≈ {fmtAmt(q.gasCostWei, 18, 3)} {q.tokenIn.chainId === 97 ? "tBNB" : "BNB"}
                      {q.gasScored && q.gasInOut > 0n ? ` (${fmtAmt(q.gasInOut, q.tokenOut.decimals, 3)} ${q.tokenOut.symbol})` : ""}
                    </span>
                    <span className="sm:text-right">
                      {q.best ? "Best net output" : `${(q.vsBestBps / 100).toFixed(2)}% vs best`}
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
            {errors.length} provider{errors.length > 1 ? "s" : ""} had no quote
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
          Selected: {selected.label} ·{" "}
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
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-2xl border border-line px-4 py-3 font-medium ${done ? "bg-card" : bad ? "bg-down/10" : "bg-card-2"}`}>
      <span className="font-semibold">Relay: </span>
      {error
        ? `Could not read the status (${error}). Your funds are not lost; check relay.link.`
        : done
          ? `Filled on ${dest}.`
          : bad
            ? `Status "${status}". If refunded, the funds go back to your wallet on BNB Chain.`
            : `Waiting for the fill on ${dest} (${status ?? "checking"})…`}
      <a className="ml-2 underline" href={`https://relay.link/transaction/${id}`} target="_blank" rel="noreferrer">
        Track on relay.link ↗
      </a>
    </div>
  );
}

function HowRouting() {
  return (
    <Panel tone="raised" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">How the best route is picked</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 font-medium text-sub">
        <li>Every provider is asked in parallel for the same amount and slippage.</li>
        <li>
          <b>Net output = what you receive − estimated gas.</b> Received amounts already include each provider&apos;s fees (pool fee, Relay fee). Gas is priced in
          the output token.
        </li>
        <li>Highest net output wins; ties go to the cheaper-gas route. You can pick any route yourself.</li>
        <li>Quotes refresh every 20 s and are re-checked by the contracts: if the price moves past your slippage, the transaction reverts and only gas is spent.</li>
      </ol>
    </Panel>
  );
}

function ProvidersPanel() {
  const rows: { id: ProviderId; what: string; state: string; on: boolean }[] = [
    { id: "pancakeV3", what: "On-chain QuoterV2 + SmartRouter", state: "Keyless · mainnet + testnet", on: true },
    { id: "pancakeV2", what: "On-chain router getAmountsOut", state: "Keyless · mainnet + testnet", on: true },
    { id: "uniswapV3", what: "On-chain QuoterV2 + SwapRouter02", state: "Keyless · mainnet", on: true },
    { id: "relay", what: "Cross-chain bridge + swap API", state: "Keyless · mainnet", on: true },
    { id: "zeroex", what: "Aggregator API v2", state: PROVIDER_KEYS_SET.zeroex ? "Key set" : "Off · needs NEXT_PUBLIC_ZEROX_API_KEY", on: PROVIDER_KEYS_SET.zeroex },
    { id: "oneinch", what: "Aggregator API v6", state: PROVIDER_KEYS_SET.oneinch ? "Key set" : "Off · needs NEXT_PUBLIC_ONEINCH_API_KEY", on: PROVIDER_KEYS_SET.oneinch },
  ];
  return (
    <Panel>
      <h2 className="text-[20px] font-semibold tracking-tight">Providers</h2>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-3 sm:gap-y-1.5">
            <div className="min-w-0">
              <a className="font-display text-[17px] font-semibold underline decoration-2 underline-offset-2" href={PROVIDER_SITE[r.id]} target="_blank" rel="noreferrer">
                {PROVIDER_LABEL[r.id]}
              </a>
              <div className="text-sm font-medium text-muted">{r.what}</div>
            </div>
            <span
              className={`max-w-full rounded-2xl px-3 py-1 text-left text-xs font-semibold [overflow-wrap:anywhere] sm:text-right ${r.on ? "bg-card-2 text-fg" : "border border-dashed border-line bg-card text-sub"}`}
            >
              {r.state}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TwakDeskCard() {
  return (
    <Panel tone="gold" shadow={false}>
      <h2 className="text-[20px] font-semibold tracking-tight">Trading TWAK?</h2>
      <p className="mt-2 font-medium text-sub">
        TWAK ⇄ BNB lives on the Towack desk: it goes through TowackRouter, so Agent ID wallets earn weekly rebates. Swaps on this page go straight to
        third-party contracts and earn no Towack rebate.
      </p>
      <div className="mt-4">
        <Link href="/trade" className="font-display text-[17px] font-semibold underline decoration-[3px] underline-offset-4 hover:text-gold">
          Open the TWAK desk →
        </Link>
      </div>
    </Panel>
  );
}
