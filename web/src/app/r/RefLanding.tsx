"use client";

import { zeroAddress } from "viem";
import { useReadContract } from "wagmi";
import { AgentPathPanel } from "@/components/AgentPath";
import { ButtonLink, Panel, Pill } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { agentNftAbi } from "@/lib/genesis";
import { mintHref, shortAddr, useReferralFromUrl } from "@/lib/referral";

export function RefLanding() {
  const { addresses, chainId } = useTowack();
  const urlRef = useReferralFromUrl();
  const bareHandle = urlRef.handle?.replace(/\.ai$/, "");

  // When `?ref=` is absent on mainnet, try resolving the handle on-chain via HandleRegistry.ownerOfHandle(string).
  const { data: resolvedOwner, isLoading: resolving } = useReadContract({
    address: addresses.agentId,
    abi: agentNftAbi,
    functionName: "ownerOfHandle",
    args: bareHandle ? [bareHandle] : undefined,
    chainId,
    query: { enabled: Boolean(!urlRef.address && bareHandle && addresses.agentId), retry: false },
  });
  const onchainAddr = resolvedOwner && resolvedOwner !== zeroAddress ? resolvedOwner : undefined;
  const ref = { address: urlRef.address ?? onchainAddr, handle: urlRef.handle };

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <Panel>
          <Pill tone="candy">INVITED BY</Pill>
          <div className="mt-3 font-display text-[36px] font-extrabold leading-tight break-words">{ref.handle ?? "a Towack friend"}</div>
          {ref.address ? (
            <p className="mt-2 font-mono text-sm font-bold text-navy/70 break-all" title={ref.address}>
              Referrer wallet {shortAddr(ref.address)}
              {!urlRef.address && onchainAddr ? " (resolved on-chain)" : ""}
            </p>
          ) : resolving ? (
            <p className="mt-3 rounded-2xl border-[3px] border-navy bg-ice px-4 py-3 font-bold">Resolving handle on-chain…</p>
          ) : (
            <p className="mt-3 rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
              This link has no referrer wallet (<code className="rounded bg-white px-1">?ref=0x…</code>), so a mint from here credits nobody. Ask
              your friend for their full link from the Referrals page.
            </p>
          )}
          <ButtonLink href={mintHref(ref)} tone="candy" size="lg" className="mt-6 w-full">
            Mint + spin
          </ButtonLink>
          <ul className="mt-6 space-y-2 font-bold text-navy/80">
            <li>★ You need an Agent ID in the wallet you mint with (one mint per Agent ID wallet).</li>
            <li>★ The referral is checked on-chain: it must be someone else&apos;s wallet that holds an Agent ID.</li>
            <li>★ Game of chance, not an investment. Most spins get back less than the 0.1 BNB paid.</li>
          </ul>
        </Panel>
      </div>
      <div className="col-span-12 lg:col-span-7">
        <Panel tone="skyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">Minting with an AI agent?</h2>
          <p className="mt-1 font-bold text-navy/70">Give your agent this instruction. The referrer is already filled in.</p>
          <AgentPathPanel flow="launch" referral={ref.address ? ref : undefined} className="mt-4" />
        </Panel>
      </div>
    </div>
  );
}
