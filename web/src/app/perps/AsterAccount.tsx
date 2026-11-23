"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { isAddress, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { ConnectPill } from "@/components/ConnectPill";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import {
  agentAddressFromKey,
  agentSnapshot,
  explainAsterError,
  forgetAgent,
  normaliseKey,
  parseStoredAgent,
  registerAgent,
  saveAgent,
  subscribeAgent,
  type StoredAgent,
} from "@/lib/aster/client";
import { ASTER_API_WALLET_URL, trimDecimal, type AsterNet } from "@/lib/aster/markets";
import { useAsterBalance } from "./useAsterAccount";
import { useNow } from "@/lib/useNow";
import { AGENT_SCOPE, AGENT_TTL_DAYS, ASTER_EVM_SIGNATURE_CHAIN_ID, approvalMessage, asterTypedData, defaultAgentName, nextNonce } from "@/lib/aster/sign";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The user's API wallet for this Aster network, straight from this browser's storage. */
export function useAsterAgent(net: AsterNet): StoredAgent | undefined {
  const raw = useSyncExternalStore(subscribeAgent, () => agentSnapshot(net), () => null);
  return useMemo(() => parseStoredAgent(raw, net), [raw, net]);
}

export function AsterAccountCard({ net, agent }: { net: AsterNet; agent: StoredAgent | undefined }) {
  return (
    <Panel tone="card" shadow={false} className="!p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">Your Aster API wallet</h2>
        <Pill tone="neutral">Stays in this browser</Pill>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        Aster trades are signed by an <b>API wallet</b>: a key that can place and cancel perp orders for your account but can never withdraw. It lives
        only in this browser&apos;s storage. Towack has no server that sees it; only signatures go, straight to Aster.
      </p>
      <div className="mt-4 text-[13px]">{agent ? <AgentStatus agent={agent} /> : <AgentSetup net={net} />}</div>
    </Panel>
  );
}

function AgentStatus({ agent }: { agent: StoredAgent }) {
  const [sure, setSure] = useState(false);
  const exp = agent.expired ? new Date(agent.expired) : undefined;
  const now = useNow(60_000);
  const expired = exp && now ? exp.getTime() < now * 1000 : false;
  const balance = useAsterBalance(agent);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Account" value={<span className="font-mono text-[18px]">{short(agent.user)}</span>} sub="main wallet" />
        <Stat
          label="API wallet"
          value={<span className="font-mono text-[18px]">{short(agent.signer)}</span>}
          sub={`${agent.source === "generated" ? "made here, approved by your wallet" : "pasted from Aster"} · ${agent.remember ? "remembered on this device" : "this tab only"}`}
        />
      </div>
      {exp ? (
        <p className={`text-sm font-medium ${expired ? "text-down" : "text-sub"}`}>
          {expired ? "Expired" : "Expires"} {exp.toLocaleString()}. Perps only, no spot, no withdrawals.
        </p>
      ) : null}
      <div className="rounded-2xl border border-line bg-card px-4 py-3 font-medium">
        {balance.isPending ? (
          "Checking your Aster USDT margin…"
        ) : balance.error ? (
          <span className="text-down">{explainAsterError(balance.error)}</span>
        ) : balance.data ? (
          <>
            USDT margin: {trimDecimal(balance.data.balance)} · available {trimDecimal(balance.data.available)}
          </>
        ) : (
          "No USDT margin on Aster yet. Deposit on asterdex.com first."
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {sure ? (
          <>
            <Button tone="gold" size="sm" onClick={() => forgetAgent(agent.net)}>
              Yes, forget this key
            </Button>
            <Button tone="line" size="sm" onClick={() => setSure(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button tone="line" size="sm" onClick={() => setSure(true)}>
            Forget key on this browser
          </Button>
        )}
        <a className="inline-flex min-h-10 items-center text-sm font-semibold underline" href={ASTER_API_WALLET_URL[agent.net]} target="_blank" rel="noreferrer">
          Manage / revoke on Aster ↗
        </a>
      </div>
      <p className="text-xs font-medium text-muted">Forgetting only deletes it here. Revoke it on Aster to switch it off everywhere.</p>
    </div>
  );
}

function AgentSetup({ net }: { net: AsterNet }) {
  const [mode, setMode] = useState<"wallet" | "paste">("wallet");
  const [remember, setRemember] = useState(false);
  return (
    <div>
      <div className="inline-flex rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label="How to set up the API wallet">
        {(
          [
            ["wallet", "Approve with my wallet"],
            ["paste", "Paste an Aster key"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${mode === m ? "bg-card-2" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">{mode === "wallet" ? <WalletApprove net={net} remember={remember} /> : <PasteKey net={net} remember={remember} />}</div>
      <label className="mt-5 flex items-start gap-3 font-medium">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          Remember on this device (localStorage). Off: kept for this tab only (sessionStorage) and gone when you close it. Don&apos;t tick this on a
          shared computer.
        </span>
      </label>
    </div>
  );
}

function WalletApprove({ net, remember }: { net: AsterNet; remember: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const onBsc = chainId === ASTER_EVM_SIGNATURE_CHAIN_ID;

  async function approve() {
    if (!address) return;
    setErr(undefined);
    setBusy(true);
    try {
      // A fresh key made in this browser; it never leaves it. Only its ADDRESS goes into the approval.
      const key = generatePrivateKey();
      const signer = privateKeyToAccount(key).address;
      const approval = { user: address, agentName: defaultAgentName(), agentAddress: signer, expired: Date.now() + AGENT_TTL_DAYS * 86_400_000, nonce: nextNonce() };
      const signature = await signTypedDataAsync(asterTypedData(approvalMessage(approval), ASTER_EVM_SIGNATURE_CHAIN_ID));
      await registerAgent(net, approval, signature);
      saveAgent({ v: 1, net, user: address, signer, key, expired: approval.expired, source: "generated", remember });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied/i.test(m) ? "You declined the signature. Nothing was approved." : /nonce/i.test(m) ? `${m}. Aster needs the signature within ~10 seconds; try again.` : explainAsterError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-line bg-card p-5 text-center">
        <p className="font-medium text-sub">Connect the wallet you use on Aster (the one that holds your margin).</p>
        <div className="mt-4 flex justify-center">
          <ConnectPill />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 font-medium text-sub">
        <li>This page makes a fresh API wallet key in your browser.</li>
        <li>
          Your wallet signs one EIP-712 message approving it on Aster: perps <b>yes</b>, spot <b>no</b>, withdrawals <b>no</b>, expires in{" "}
          {AGENT_TTL_DAYS} days. It is a signature, not a transaction: no gas, nothing broadcast.
        </li>
        <li>The approval goes straight to Aster. The key stays here.</li>
      </ol>
      <p className="rounded-2xl border border-line bg-card px-4 py-2 text-sm font-medium">
        Signing: <span className="font-mono">AsterSignTransaction</span> · chain 56 · canPerpTrade={String(AGENT_SCOPE.canPerpTrade)} · canSpotTrade=
        {String(AGENT_SCOPE.canSpotTrade)} · canWithdraw={String(AGENT_SCOPE.canWithdraw)}
      </p>
      {net === "testnet" ? (
        <p className="text-sm font-medium text-sub">
          Aster testnet still expects the approval signed for chain 56 (its docs), so your wallet must be on BNB Smart Chain just for this signature.
        </p>
      ) : null}
      {!onBsc ? (
        <Button tone="soft" size="md" disabled={switching} onClick={() => switchChainAsync({ chainId: ASTER_EVM_SIGNATURE_CHAIN_ID }).catch(() => undefined)}>
          {switching ? "Check your wallet…" : "Switch wallet to BNB Smart Chain to sign"}
        </Button>
      ) : (
        <Button tone="soft" size="md" disabled={busy} onClick={approve}>
          {busy ? "Sign in your wallet…" : "Approve a trade-only API wallet"}
        </Button>
      )}
      {err ? (
        <p role="alert" className="rounded-2xl border border-line bg-down/10 px-4 py-3 font-medium">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function PasteKey({ net, remember }: { net: AsterNet; remember: boolean }) {
  const { address } = useAccount();
  const [user, setUser] = useState("");
  const [key, setKey] = useState("");
  const userValue = user || address || "";
  const signer = agentAddressFromKey(key);
  const userOk = isAddress(userValue.trim());
  return (
    <div className="space-y-4">
      <p className="font-medium text-sub">
        Already made an API wallet on{" "}
        <a className="underline" href={ASTER_API_WALLET_URL[net]} target="_blank" rel="noreferrer">
          Aster&apos;s API wallet page
        </a>{" "}
        (Pro API)? Paste its private key. Give it perps permission only, never withdrawals.
      </p>
      <Field label="Aster account (main wallet address)">
        <input className={`${inputClass} font-mono !text-[15px]`} placeholder="0x…" value={userValue} onChange={(e) => setUser(e.target.value.trim())} spellCheck={false} />
      </Field>
      <Field label="API wallet private key" hint={key && !signer ? "That doesn't look like a 32-byte hex private key." : signer ? `API wallet address: ${signer}` : "Stays in this browser. Never your main wallet's key."}>
        <input
          className={`${inputClass} font-mono !text-[15px]`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x… (64 hex characters)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Button
        tone="soft"
        size="md"
        disabled={!signer || !userOk}
        onClick={() => {
          if (!signer || !userOk) return;
          saveAgent({ v: 1, net, user: getAddress(userValue.trim()), signer, key: normaliseKey(key), expired: 0, source: "pasted", remember });
          setKey("");
        }}
      >
        Use this API wallet
      </Button>
    </div>
  );
}
