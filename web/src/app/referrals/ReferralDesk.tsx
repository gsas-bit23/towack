"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, towackLaunchAbi } from "@/abi";
import { AgentPathPanel, AgentPathToggle } from "@/components/AgentPath";
import { AddressLink, NeedsContracts, NeedsWallet, RpcErrorNotice, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18 } from "@/lib/format";
import { agentNftAbi } from "@/lib/genesis";
import { normalizeHandle, referralLink } from "@/lib/referral";
import { useTx } from "@/lib/tx";
import { useLocale } from "@/lib/i18n";

const HANDLE_KEY = "towack.referralHandle";

export function ReferralDesk() {
  const { account, addresses, chainId } = useTowack();
  const [typed, setTyped] = useState("");
  const [origin, setOrigin] = useState("");
  const { t } = useLocale();

  // On mainnet, SPACE ID HandleRegistry exposes handleOf(address) on-chain; if the read fails it degrades gracefully.
  const { data: onchainHandle } = useReadContract({
    address: addresses.agentId,
    abi: agentNftAbi,
    functionName: "handleOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(addresses.agentId && account), retry: false },
  });

  useEffect(() => {
    const read = () => {
      setOrigin(window.location.origin);
      const saved = window.localStorage.getItem(HANDLE_KEY);
      if (saved) setTyped((t) => t || saved);
    };
    read();
    window.addEventListener("pageshow", read);
    return () => window.removeEventListener("pageshow", read);
  }, []);
  const effectiveRaw = typed.trim() || (onchainHandle ? `${onchainHandle}.ai` : "");
  const handle = normalizeHandle(effectiveRaw);
  useEffect(() => {
    if (typed.trim() && handle) window.localStorage.setItem(HANDLE_KEY, handle);
  }, [typed, handle]);

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 space-y-8 lg:col-span-7">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[21px] font-semibold tracking-tight">{t("ref.linkTitle")}</h2>
          </div>
          <div className="mt-5">
            <Field
              label={t("ref.handle")}
              hint={onchainHandle ? t("ref.detected", { h: `${onchainHandle}.ai` }) : t("ref.handleHint")}
            >
              <input
                className={inputClass}
                placeholder={onchainHandle ? `${onchainHandle}.ai` : "yourname.ai"}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-6">
            <NeedsWallet why={t("ref.connectWhy")}>
              {account ? <ShareBox origin={origin} account={account} handle={handle} /> : null}
            </NeedsWallet>
          </div>
        </Panel>

        <Panel tone="raised" shadow={false}>
          <h2 className="text-[20px] font-semibold tracking-tight">{t("ref.how")}</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 font-medium text-sub">
            <li>{t("ref.how1")}</li>
            <li>{t("ref.how2")}</li>
            <li>{t("ref.how3")}</li>
            <li>{t("ref.how4")}</li>
            <li>{t("ref.how5")}</li>
          </ol>
        </Panel>
      </div>

      <div className="col-span-12 space-y-8 lg:col-span-5">
        <Panel>
          <h2 className="text-[21px] font-semibold tracking-tight">{t("ref.yours")}</h2>
          <div className="mt-5">
            <NeedsContracts keys={["launch"]}>
              <NeedsWallet why={t("ref.dashWhy")} agent="referralClaim">
                {account ? <Dashboard account={account} /> : null}
              </NeedsWallet>
            </NeedsContracts>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ShareBox({ origin, account, handle }: { origin: string; account: Address; handle?: string }) {
  const { addresses, chainId } = useTowack();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const { t } = useLocale();
  const link = origin ? referralLink(origin, account, handle) : "";

  const { data: agentBal } = useReadContract({
    address: addresses.agentId,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: [account],
    chainId,
    query: { enabled: Boolean(addresses.agentId) },
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div>
      {agentBal === 0n ? (
        <p className="mb-4 rounded-2xl border border-line bg-down/10 px-4 py-3 font-medium">
          <Pill tone="gold">{t("ref.noAgentPill")}</Pill> {t("ref.noAgent")}
        </p>
      ) : null}
      <div className="rounded-2xl border border-line bg-card-2 px-4 py-3 font-mono text-[13px] font-medium break-all" aria-label={t("ref.linkAria")}>
        {link || "…"}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button tone="soft" size="sm" onClick={copy} disabled={!link}>
          {copied === "ok" ? t("common.copied") : copied === "fail" ? t("common.copyFailed") : t("ref.copy")}
        </Button>
        {handle ? <Pill tone="neutral">{handle}</Pill> : null}
      </div>
      <h3 className="mt-6 text-[17px] font-semibold tracking-tight">{t("ref.agentTitle")}</h3>
      <p className="mt-1 font-medium text-sub">{t("ref.agentBody")}</p>
      <AgentPathPanel flow="launch" referral={{ address: account, handle }} className="mt-3" />
    </div>
  );
}

function Dashboard({ account }: { account: Address }) {
  const { addresses, chainId } = useTowack();
  const launch = addresses.launch;
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const { t } = useLocale();

  const { data, isError: dashErr, refetch } = useReadContracts({
    contracts: [
      { address: launch, abi: towackLaunchAbi, functionName: "referralCount", args: [account], chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "referralEarned", args: [account], chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "referralUnclaimed", args: [account], chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "referees", args: [account], chainId },
    ],
    query: { enabled: Boolean(launch), refetchInterval: 20_000 },
  });
  const [countR, earnedR, unclaimedR, refereesR] = data ?? [];
  // A launch contract deployed before referrals has none of these views: every read fails.
  const unsupported = Boolean(data && data.every((d) => d.status === "failure"));
  const count = countR?.result;
  const earned = earnedR?.result;
  const unclaimed = unclaimedR?.result;
  const referees = refereesR?.result;

  const claim = async () => {
    if (!launch) return;
    const ok = await tx.run(t("ref.txClaim"), () =>
      writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "claimReferral", chainId }),
    );
    if (ok) void refetch();
  };

  if (unsupported) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-gold/5 px-4 py-3 font-medium">
        {t("ref.unsupported")}
      </p>
    );
  }

  return (
    <div>
      {dashErr ? <RpcErrorNotice onRetry={() => void refetch()} label={t("ref.loadErr")} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Stat label={t("ref.friends")} value={count !== undefined ? count.toString() : "—"} />
        <Stat label={t("ref.lifetime")} value={earned !== undefined ? `${fmt18(earned, 4)} BNB` : "—"} />
        <Stat label={t("ref.claimable")} value={unclaimed !== undefined ? `${fmt18(unclaimed, 4)} BNB` : "—"} sub={t("ref.neverExpires")} className="sm:col-span-2 lg:col-span-1 xl:col-span-2" />
      </div>
      <Button tone="gold" size="lg" className="mt-6 w-full" disabled={!unclaimed || tx.busy} onClick={claim}>
        {tx.busy ? t("wallet.checkWallet") : unclaimed ? t("ref.claimAmt", { n: fmt18(unclaimed, 4) }) : t("ref.nothing")}
      </Button>
      <TxNotice state={tx.state} onClose={tx.reset} />
      <AgentPathToggle flow="referralClaim" className="mt-3" />

      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">{t("ref.friendsTitle")}</h3>
      {referees && referees.length > 0 ? (
        <ul className="mt-3 max-h-[280px] space-y-2 overflow-auto pr-1">
          {referees.map((r, i) => (
            <li key={r} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card-2 px-4 py-2 font-medium">
              <span className="text-sm text-muted">#{i + 1}</span>
              <AddressLink address={r} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 font-medium text-muted">{referees ? t("ref.noReferred") : "—"}</p>
      )}
    </div>
  );
}
