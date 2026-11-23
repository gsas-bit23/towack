"use client";

import type { ReactNode } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import type { ContractKey } from "@/config/addresses";
import { useTowack } from "@/lib/chain";
import type { TxState } from "@/lib/tx";
import { ConnectPill } from "./ConnectPill";
import { AgentPathToggle, type AgentFlow, type AgentReferral } from "./AgentPath";
import { Button, Pill } from "./ui";

export function DeployingSoon({ children }: { keys?: ContractKey[]; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-line-2 bg-card p-8 text-center">
      <Pill tone="neutral">Unavailable</Pill>
      <h3 className="mt-4 text-[26px] font-semibold leading-tight tracking-tight">Temporarily unavailable</h3>
      <p className="mx-auto mt-2 max-w-[560px] font-medium text-sub">This part of Towack is not available right now. Please check back soon.</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** Global wrong-network banner rendered directly below the nav bar. */
export function SiteNetworkBanner() {
  const { wrongNetwork, switchToApp, isSwitching } = useTowack();
  if (wrongNetwork) {
    return (
      <div role="alert" className="border-b border-line bg-gold/10 px-4 py-2.5 text-fg">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-3 text-sm font-semibold">
          <span>Your wallet is on another network. Towack runs on BNB Chain.</span>
          <Button tone="soft" size="sm" disabled={isSwitching} onClick={switchToApp}>
            Switch to BNB Chain
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

/** Inline RPC read error notice with optional retry action. */
export function RpcErrorNotice({ onRetry, label = "Could not load on-chain data right now." }: { onRetry?: () => void; label?: string }) {
  return (
    <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-down/10 px-4 py-3 font-medium">
      <span>{label} Check your connection or try again.</span>
      {onRetry ? (
        <Button tone="line" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Renders children only when every listed contract address is configured for the current chain. */
export function NeedsContracts({ keys, children, soon }: { keys: ContractKey[]; children: ReactNode; soon?: ReactNode }) {
  const { has } = useTowack();
  if (!has(...keys)) return <DeployingSoon keys={keys}>{soon}</DeployingSoon>;
  return <>{children}</>;
}

/** `agent`: also offer the "Give this to your AI agent" (Binance Agentic Wallet) copy-paste path. */
export function NeedsWallet({ children, why, agent, referral }: { children: ReactNode; why?: string; agent?: AgentFlow; referral?: AgentReferral }) {
  const { isConnected, wrongNetwork, switchToApp, isSwitching } = useTowack();
  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-line bg-card-2 p-7 text-center">
        <p className="font-display text-[22px] font-semibold">Connect your wallet to play</p>
        <p className="mt-1 font-medium text-sub">{why ?? "Every action is signed in your own wallet. We never see your keys."}</p>
        <div className="mt-5 flex justify-center">
          <ConnectPill />
        </div>
        {agent ? <AgentPathToggle flow={agent} referral={referral} className="mt-4" /> : null}
      </div>
    );
  }
  if (wrongNetwork) {
    return (
      <div className="rounded-2xl border border-line bg-down/10 p-7 text-center">
        <p className="font-display text-[22px] font-semibold">Wrong network</p>
        <p className="mt-1 font-medium text-sub">Towack runs on BNB Chain. Switch in your wallet to continue.</p>
        <div className="mt-5 flex justify-center">
          <Button tone="soft" size="sm" disabled={isSwitching} onClick={switchToApp}>
            Switch to BNB Chain
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function TxNotice({ state, onClose }: { state: TxState; onClose?: () => void }) {
  const { meta } = useTowack();
  if (state.status === "idle") return null;
  const hash = "hash" in state ? state.hash : undefined;
  const styles = {
    wallet: "bg-gold/5",
    pending: "bg-card-2",
    success: "bg-card",
    error: "bg-down/10",
  }[state.status];
  const text = {
    wallet: "Confirm in your wallet…",
    pending: "Sent. Waiting for the block…",
    success: "Done!",
    error: state.status === "error" ? state.message : "",
  }[state.status];
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-2xl border border-line px-4 py-3 font-medium ${styles}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-semibold">{state.label}: </span>
          {text}
          {hash ? (
            <a className="ml-2 underline decoration-2 underline-offset-2 hover:text-gold" href={`${meta.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
              View tx ↗
            </a>
          ) : null}
        </div>
        {onClose && (state.status === "success" || state.status === "error") ? (
          <button type="button" onClick={onClose} className="font-semibold text-muted hover:text-fg" aria-label="Dismiss">
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ChainNote() {
  const { meta } = useTowack();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-sub">
      <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-fg">{meta.name.toUpperCase()}</span>
      Real BNB. Only play with what you can afford to lose.
    </div>
  );
}

export function AddressLink({ address, label }: { address?: string; label?: string }) {
  const { meta } = useTowack();
  if (!address) return <span className="text-muted">not set</span>;
  return (
    <a href={`${meta.explorer}/address/${address}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center font-mono text-sm underline decoration-2 underline-offset-2 hover:text-gold">
      {label ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
    </a>
  );
}

/** Shown when the configured launch address is the pre-wheel contract (no per-mint deck ABI). */
export function LegacyLaunchNote() {
  return (
    <p className="mt-4 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
      Minting is temporarily paused. Please check back soon.
    </p>
  );
}

const VRF_SOURCE_ABI = [
  { type: "function", name: "vrfWrapper", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "vrfCoordinator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

/**
 * Where a contract's randomness comes from, read on-chain: `vrfWrapper()` on the wrapper-model contracts (official
 * Chainlink VRF v2.5 direct-funding wrapper), else `vrfCoordinator()` on older deploys. Shows a badge only when
 * the source is the official Chainlink VRF; anything else gets a short caution.
 */
export function VrfSource({ consumer }: { consumer?: Address }) {
  const { chainId, addresses, meta } = useTowack();
  const { data: wrapper, isError: noWrapper } = useReadContract({
    address: consumer,
    abi: VRF_SOURCE_ABI,
    functionName: "vrfWrapper",
    chainId,
    query: { enabled: Boolean(consumer), staleTime: Infinity, retry: false },
  });
  const { data: coordinator } = useReadContract({
    address: consumer,
    abi: VRF_SOURCE_ABI,
    functionName: "vrfCoordinator",
    chainId,
    query: { enabled: Boolean(consumer) && noWrapper, staleTime: Infinity, retry: false },
  });
  const data = wrapper ?? coordinator;
  if (!consumer || !data) return null;
  const same = (a?: Address) => Boolean(a) && data.toLowerCase() === a!.toLowerCase();
  const official = wrapper ? same(addresses.vrfWrapper) : same(addresses.vrfCoordinator);
  if (official) {
    return (
      <a
        href={`${meta.explorer}/address/${data}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-card px-3 text-xs font-semibold text-fg hover:text-gold"
      >
        ✓ Chainlink VRF v2.5
      </a>
    );
  }
  return (
    <p className="rounded-2xl border border-line bg-gold/5 px-4 py-2 text-sm font-medium">
      Randomness source not verified as Chainlink VRF. Check the contract before playing.
    </p>
  );
}
