"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { ConnectPill } from "@/components/ConnectPill";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import {
  agentSnapshot,
  explainAsterError,
  forgetAgent,
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

// Towack never asks for a private key. The only setup path makes a fresh trade-only API key in this browser and has
// the user approve its ADDRESS with their own wallet (Agent ID Hackathon rule: no collection of keys or secrets).
function AgentSetup({ net }: { net: AsterNet }) {
  const [remember, setRemember] = useState(false);
  const { t } = useLocale();
  return (
    <div>
      <WalletApprove net={net} remember={remember} />
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

