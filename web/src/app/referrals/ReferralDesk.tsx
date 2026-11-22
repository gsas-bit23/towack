"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, towackLaunchAbi } from "@/abi";
import { AgentPathPanel, AgentPathToggle } from "@/components/AgentPath";
import { AddressLink, ChainNote, NeedsContracts, NeedsWallet, RpcErrorNotice, TxNotice } from "@/components/status";
import { Button, Field, Panel, Pill, Stat, inputClass } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18 } from "@/lib/format";
import { agentNftAbi } from "@/lib/genesis";
import { normalizeHandle, referralLink } from "@/lib/referral";
import { useTx } from "@/lib/tx";

const HANDLE_KEY = "towack.referralHandle";

export function ReferralDesk() {
  const { account, addresses, chainId } = useTowack();
  const [typed, setTyped] = useState("");
  const [origin, setOrigin] = useState("");

  // On mainnet, SPACE ID HandleRegistry exposes handleOf(address) on-chain; on testnet mocks this fails gracefully.
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
            <h2 className="font-display text-[28px] font-extrabold">Your referral link</h2>
            <ChainNote />
          </div>
          <div className="mt-5">
            <Field
              label="Your .ai handle (optional)"
              hint={
                onchainHandle
                  ? `Detected ${onchainHandle}.ai on-chain for this wallet. The referrer is always your wallet address.`
                  : "Optional label on your link (auto-detected on mainnet). The referrer is always the wallet address in the link."
              }
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
            <NeedsWallet why="Connect the wallet that should earn referrals (it must hold an Agent ID).">
              {account ? <ShareBox origin={origin} account={account} handle={handle} /> : null}
            </NeedsWallet>
          </div>
        </Panel>

        <Panel tone="skyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">How referrals work</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 font-bold text-navy/80">
            <li>Your link carries your wallet address. Friends who open it mint with <code className="rounded bg-white px-1">mint(your address)</code>.</li>
            <li>Each referred paid mint credits you 0.005 BNB (5% of the 0.1 BNB price). It comes out of the share that would otherwise go to LP / Draw V2, so your friend pays nothing extra.</li>
            <li>Your wallet must hold an Agent ID, and you can&apos;t refer yourself: the contract rejects both.</li>
            <li>Claim any time with <code className="rounded bg-white px-1">claimReferral()</code>. Referral BNB has no deadline and is never swept.</li>
            <li>Paid mint only. Genesis 300 has no referrals.</li>
          </ol>
          <p className="mt-4 font-semibold text-navy/70">Minting is a game of chance, not an investment. Only share with friends who understand that.</p>
        </Panel>
      </div>

      <div className="col-span-12 space-y-8 lg:col-span-5">
        <Panel>
          <h2 className="font-display text-[28px] font-extrabold">Your referrals</h2>
          <div className="mt-5">
            <NeedsContracts keys={["launch"]}>
              <NeedsWallet why="Connect to see your referrals and claim." agent="referralClaim">
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
        <p className="mb-4 rounded-2xl border-[3px] border-navy bg-candy-pale px-4 py-3 font-bold">
          <Pill tone="candy">NO AGENT ID</Pill> This wallet holds no Agent ID, so mints naming it would revert. Get an Agent ID in the official
          Binance App (mainnet) first.
        </p>
      ) : null}
      <div className="rounded-2xl border-[3px] border-navy bg-ice px-4 py-3 font-mono text-[13px] font-bold break-all" aria-label="Your referral link">
        {link || "…"}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button tone="sun" size="sm" onClick={copy} disabled={!link}>
          {copied === "ok" ? "Copied ✓" : copied === "fail" ? "Copy failed: select the text" : "Copy link"}
        </Button>
        {handle ? <Pill tone="navy">{handle}</Pill> : null}
      </div>
      <h3 className="mt-6 font-display text-[20px] font-extrabold">For friends with an AI agent</h3>
      <p className="mt-1 font-bold text-navy/70">Send them this ready-made instruction. It mints on mainnet (chain 56) with your wallet as referrer.</p>
      <AgentPathPanel flow="launch" referral={{ address: account, handle }} className="mt-3" />
    </div>
  );
}

function Dashboard({ account }: { account: Address }) {
  const { addresses, chainId } = useTowack();
  const launch = addresses.launch;
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

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
    const ok = await tx.run("Claim referral BNB", () =>
      writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "claimReferral", chainId }),
    );
    if (ok) void refetch();
  };

  if (unsupported) {
    return (
      <p className="rounded-2xl border-[3px] border-dashed border-navy bg-sun-pale px-4 py-3 font-bold">
        The launch contract on this network was deployed before referrals. Referral stats and claims go live with the next launch deploy.
      </p>
    );
  }

  return (
    <div>
      {dashErr ? <RpcErrorNotice onRetry={() => void refetch()} label="Could not load referral stats." /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Stat label="Friends minted" value={count !== undefined ? count.toString() : "—"} />
        <Stat label="Lifetime earned" value={earned !== undefined ? `${fmt18(earned, 4)} BNB` : "—"} />
        <Stat label="Claimable" value={unclaimed !== undefined ? `${fmt18(unclaimed, 4)} BNB` : "—"} sub="never expires" className="sm:col-span-2 lg:col-span-1 xl:col-span-2" />
      </div>
      <Button tone="candy" size="lg" className="mt-6 w-full" disabled={!unclaimed || tx.busy} onClick={claim}>
        {tx.busy ? "Check your wallet…" : unclaimed ? `Claim ${fmt18(unclaimed, 4)} BNB` : "Nothing to claim yet"}
      </Button>
      <p className="mt-3 text-center text-sm font-bold text-navy/60">Your wallet will ask you to confirm. We never sign for you.</p>
      <TxNotice state={tx.state} onClose={tx.reset} />
      <AgentPathToggle flow="referralClaim" className="mt-4" />

      <h3 className="mt-8 font-display text-[20px] font-extrabold">Friends who minted</h3>
      {referees && referees.length > 0 ? (
        <ul className="mt-3 max-h-[280px] space-y-2 overflow-auto pr-1">
          {referees.map((r, i) => (
            <li key={r} className="flex items-center justify-between gap-3 rounded-2xl border-[3px] border-navy bg-ice px-4 py-2 font-bold">
              <span className="text-sm text-navy/60">#{i + 1}</span>
              <AddressLink address={r} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 font-bold text-navy/60">{referees ? "No referred mints yet. Share your link!" : "—"}</p>
      )}
    </div>
  );
}
