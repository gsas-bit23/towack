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
import { useLocale } from "@/lib/i18n";
import { AGENT_TTL_DAYS, ASTER_EVM_SIGNATURE_CHAIN_ID, approvalMessage, asterTypedData, defaultAgentName, nextNonce } from "@/lib/aster/sign";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The user's API wallet for this Aster network, straight from this browser's storage. */
export function useAsterAgent(net: AsterNet): StoredAgent | undefined {
  const raw = useSyncExternalStore(subscribeAgent, () => agentSnapshot(net), () => null);
  return useMemo(() => parseStoredAgent(raw, net), [raw, net]);
}

export function AsterAccountCard({ net, agent }: { net: AsterNet; agent: StoredAgent | undefined }) {
  const { t, rich } = useLocale();
  return (
    <Panel tone="card" shadow={false} className="!p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">{t("perps.a.title")}</h2>
        <Pill tone="neutral">{t("perps.a.stays")}</Pill>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        {rich("perps.a.body", { b: (c) => <b>{c}</b> })}
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
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={t("perps.a.account")} value={<span className="font-mono text-[18px]">{short(agent.user)}</span>} sub={t("perps.a.mainWallet")} />
        <Stat
          label={t("perps.a.apiWallet")}
          value={<span className="font-mono text-[18px]">{short(agent.signer)}</span>}
          sub={`${agent.source === "generated" ? t("perps.a.madeHere") : t("perps.a.pasted")} · ${agent.remember ? t("perps.a.remembered") : t("perps.a.tabOnly")}`}
        />
      </div>
      {exp ? (
        <p className={`text-sm font-medium ${expired ? "text-down" : "text-sub"}`}>
          {t(expired ? "perps.a.expiredAt" : "perps.a.expiresAt", { date: exp.toLocaleString() })}
        </p>
      ) : null}
      <div className="rounded-2xl border border-line bg-card px-4 py-3 font-medium">
        {balance.isPending ? (
          t("perps.a.checkingMargin")
        ) : balance.error ? (
          <span className="text-down">{explainAsterError(balance.error)}</span>
        ) : balance.data ? (
          <>
            {t("perps.a.margin", { bal: trimDecimal(balance.data.balance), avail: trimDecimal(balance.data.available) })}
          </>
        ) : (
          t("perps.a.noMargin")
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {sure ? (
          <>
            <Button tone="gold" size="sm" onClick={() => forgetAgent(agent.net)}>
              {t("perps.a.forgetYes")}
            </Button>
            <Button tone="line" size="sm" onClick={() => setSure(false)}>
              {t("perps.a.keep")}
            </Button>
          </>
        ) : (
          <Button tone="line" size="sm" onClick={() => setSure(true)}>
            {t("perps.a.forget")}
          </Button>
        )}
        <a className="inline-flex min-h-10 items-center text-sm font-semibold underline" href={ASTER_API_WALLET_URL[agent.net]} target="_blank" rel="noreferrer">
          {t("perps.a.manage")}
        </a>
      </div>
      <p className="text-xs font-medium text-muted">{t("perps.a.forgetNote")}</p>
    </div>
  );
}

function AgentSetup({ net }: { net: AsterNet }) {
  const [mode, setMode] = useState<"wallet" | "paste">("wallet");
  const [remember, setRemember] = useState(false);
  const { t } = useLocale();
  return (
    <div>
      <div className="inline-flex rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label={t("perps.a.setupAria")}>
        {(
          [
            ["wallet", t("perps.a.approve")],
            ["paste", t("perps.a.paste")],
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
          {t("perps.a.remember")}
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
  const { t, rich } = useLocale();
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
      setErr(/reject|denied/i.test(m) ? t("perps.a.declined") : /nonce/i.test(m) ? t("perps.a.nonce", { m }) : explainAsterError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-line bg-card p-5 text-center">
        <p className="font-medium text-sub">{t("perps.a.connect")}</p>
        <div className="mt-4 flex justify-center">
          <ConnectPill />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 font-medium text-sub">
        <li>{t("perps.a.step1")}</li>
        <li>{rich("perps.a.step2", { b: (c) => <b>{c}</b> }, { days: AGENT_TTL_DAYS })}</li>
        <li>{t("perps.a.step3")}</li>
      </ol>
      {!onBsc ? (
        <Button tone="soft" size="md" disabled={switching} onClick={() => switchChainAsync({ chainId: ASTER_EVM_SIGNATURE_CHAIN_ID }).catch(() => undefined)}>
          {switching ? t("wallet.checkWallet") : t("perps.a.switchBsc")}
        </Button>
      ) : (
        <Button tone="soft" size="md" disabled={busy} onClick={approve}>
          {busy ? t("perps.a.signing") : t("perps.a.approveBtn")}
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
  const { t, rich } = useLocale();
  return (
    <div className="space-y-4">
      <p className="font-medium text-sub">
        {rich("perps.a.pasteIntro", {
          a: (c) => (
            <a className="underline" href={ASTER_API_WALLET_URL[net]} target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
        })}
      </p>
      <Field label={t("perps.a.accountField")}>
        <input className={`${inputClass} font-mono !text-[15px]`} placeholder="0x…" value={userValue} onChange={(e) => setUser(e.target.value.trim())} spellCheck={false} />
      </Field>
      <Field label={t("perps.a.keyField")} hint={key && !signer ? t("perps.a.keyBad") : signer ? t("perps.a.keyAddr", { a: signer }) : t("perps.a.keyHint")}>
        <input
          className={`${inputClass} font-mono !text-[15px]`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("perps.a.keyPh")}
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
        {t("perps.a.use")}
      </Button>
    </div>
  );
}
