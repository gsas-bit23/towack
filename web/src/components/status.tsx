"use client";

import type { ReactNode } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import type { ContractKey } from "@/config/addresses";
import { useTowack } from "@/lib/chain";
import type { TxState } from "@/lib/tx";
import { ConnectPill } from "./ConnectPill";
import { AgentPathToggle, type AgentFlow, type AgentReferral } from "./AgentPath";
import { LabelTicket } from "./art";
import { Button } from "./ui";

const KEY_LABEL: Record<ContractKey, string> = {
  agentId: "Agent ID registry",
  token: "TWAK token",
  launch: "Launch / mint",
  router: "Towack router",
  rebateDistributor: "Rebate distributor",
  teamVesting: "Team vesting",
  drawV2: "Draw V2 pool wheel",
  drawV2Legacy: "Draw V2 treasury (old)",
  timelock: "Timelock",
  wbnb: "WBNB",
  pancakeRouter: "PancakeSwap router",
  pancakeFactory: "PancakeSwap factory",
  genesis: "Genesis 300",
  genesisMock: "Genesis 300 (old, mock VRF)",
  drawV2Mock: "Draw V2 pool (old, mock VRF)",
  vrfCoordinator: "Chainlink VRF v2.5 coordinator",
  vrfWrapper: "Chainlink VRF v2.5 wrapper",
  launchVrfMock: "Test VRF coordinator (Launch)",
};

export function DeployingSoon({ keys, children }: { keys: ContractKey[]; children?: ReactNode }) {
  const { meta, addresses } = useTowack();
  const missing = keys.filter((k) => !addresses[k]);
  return (
    <div className="relative overflow-hidden rounded-[40px] border-4 border-dashed border-navy bg-sun-pale p-8 text-center">
      <LabelTicket label="SOON" className="wiggle mx-auto w-[180px]" fill="#FFCD2E" fontSize={40} />
      <h3 className="mt-4 font-display text-[34px] font-extrabold leading-tight">
        {meta.testnet ? "Contracts deploying soon" : "Launching soon on BNB Smart Chain"}
      </h3>
      <p className="mx-auto mt-2 max-w-[560px] font-bold text-navy/75">
        {meta.testnet
          ? `The Towack contracts are not live on ${meta.name} yet, so this machine is switched off. Nothing to sign, nothing to send.`
          : `Towack contracts are not live on ${meta.name} yet, so this machine is switched off. Nothing to sign, nothing to send — official addresses will appear here once deployed and verified.`}
      </p>
      {missing.length > 0 ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {missing.map((k) => (
            <span key={k} className="rounded-full border-[3px] border-navy bg-white px-3 py-1 text-xs font-black">
              {KEY_LABEL[k]}: pending deploy
            </span>
          ))}
        </div>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** Global wrong-network and mainnet-launching-soon banner rendered directly below the nav bar. */
export function SiteNetworkBanner() {
  const { wrongNetwork, meta, addresses, selectChain, isSwitching, chainId } = useTowack();
  if (wrongNetwork) {
    return (
      <div role="alert" className="border-b-4 border-navy bg-candy px-4 py-2.5 text-white">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-3 text-sm font-extrabold">
          <span>Your wallet is on an unsupported network. Switch to {meta.name} to use Towack.</span>
          <Button tone="sun" size="sm" disabled={isSwitching} onClick={() => selectChain(chainId)}>
            Switch to {meta.name}
          </Button>
        </div>
      </div>
    );
  }
  if (!meta.testnet && !addresses.launch) {
    return (
      <div role="status" className="border-b-4 border-navy bg-sun-pale px-4 py-2 text-navy">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center justify-between gap-2 text-sm font-bold">
          <span>
            <b className="font-black">BNB Smart Chain:</b> Launching soon — protocol contracts are not deployed yet. Nothing to sign or send.
          </span>
        </div>
      </div>
    );
  }
  return null;
}

/** Inline RPC read error notice with optional retry action. */
export function RpcErrorNotice({ onRetry, label = "Could not load on-chain data right now." }: { onRetry?: () => void; label?: string }) {
  return (
    <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[3px] border-navy bg-candy-pale px-4 py-3 font-bold">
      <span>{label} Check your connection or try again.</span>
      {onRetry ? (
        <Button tone="white" size="sm" onClick={onRetry}>
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

/** `agent`: also offer the "Give this to your AI agent" (Binance Agentic Wallet, mainnet-only) copy-paste path. */
export function NeedsWallet({ children, why, agent, referral }: { children: ReactNode; why?: string; agent?: AgentFlow; referral?: AgentReferral }) {
  const { isConnected, wrongNetwork, selectChain, chainId, meta } = useTowack();
  if (!isConnected) {
    return (
      <div className="rounded-[32px] border-4 border-navy bg-ice p-7 text-center">
        <p className="font-display text-[22px] font-extrabold">Connect your wallet to play</p>
        <p className="mt-1 font-bold text-navy/70">{why ?? "Every action is signed in your own wallet. We never see your keys."}</p>
        <div className="mt-5 flex justify-center">
          <ConnectPill />
        </div>
        {agent ? <AgentPathToggle flow={agent} referral={referral} className="mt-4" /> : null}
      </div>
    );
  }
  if (wrongNetwork) {
    return (
      <div className="rounded-[32px] border-4 border-navy bg-candy-pale p-7 text-center">
        <p className="font-display text-[22px] font-extrabold">Wrong network</p>
        <p className="mt-1 font-bold text-navy/70">Towack runs on {meta.name}. Switch in your wallet to continue.</p>
        <div className="mt-5 flex justify-center">
          <Button tone="sun" size="sm" onClick={() => selectChain(chainId)}>
            Switch to {meta.name}
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
    wallet: "bg-sun-pale",
    pending: "bg-sky-pale",
    success: "bg-white",
    error: "bg-candy-pale",
  }[state.status];
  const text = {
    wallet: "Confirm in your wallet…",
    pending: "Sent. Waiting for the block…",
    success: "Done!",
    error: state.status === "error" ? state.message : "",
  }[state.status];
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-2xl border-[3px] border-navy px-4 py-3 font-bold ${styles}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-black">{state.label}: </span>
          {text}
          {hash ? (
            <a className="ml-2 underline decoration-2 underline-offset-2 hover:text-candy" href={`${meta.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
              View tx ↗
            </a>
          ) : null}
        </div>
        {onClose && (state.status === "success" || state.status === "error") ? (
          <button type="button" onClick={onClose} className="font-black text-navy/60 hover:text-navy" aria-label="Dismiss">
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
    <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-navy/70">
      <span className={`rounded-full px-3 py-1 text-xs font-black ${meta.testnet ? "bg-sky text-navy" : "bg-sun text-navy"}`}>{meta.name.toUpperCase()}</span>
      {meta.testnet ? "Testnet build. Test BNB has no value." : "Mainnet view. Real BNB — only play with what you can afford to lose."}
    </div>
  );
}

export function AddressLink({ address, label }: { address?: string; label?: string }) {
  const { meta } = useTowack();
  if (!address) return <span className="text-navy/50">not set</span>;
  return (
    <a href={`${meta.explorer}/address/${address}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center font-mono text-sm underline decoration-2 underline-offset-2 hover:text-candy">
      {label ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
    </a>
  );
}

/** Shown when the configured launch address is the pre-wheel contract (no per-mint deck ABI). */
export function LegacyLaunchNote() {
  return (
    <p className="mt-4 rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
      Heads up: the launch contract on this network is the previous single-seed version. The new per-mint prize wheel contract is being
      redeployed, so minting from this page is paused until the address is updated.
    </p>
  );
}

const VRF_SOURCE_ABI = [
  { type: "function", name: "vrfWrapper", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "vrfCoordinator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

/**
 * Where a contract's randomness comes from, read on-chain: `vrfWrapper()` on the wrapper-model contracts (official
 * Chainlink VRF v2.5 direct-funding wrapper), else `vrfCoordinator()` on older deploys (official coordinator, or
 * the owner-answered test coordinator the old testnet launch contract uses).
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
        className="inline-flex min-h-10 items-center gap-2 rounded-full border-[3px] border-navy bg-white px-3 text-xs font-black text-navy hover:text-candy"
      >
        ✓ Chainlink VRF v2.5
      </a>
    );
  }
  return (
    <p className="rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-2 text-sm font-bold">
      {meta.testnet ? "Testnet: " : ""}this contract uses a test randomness coordinator, answered by the Towack team, not Chainlink VRF. Spins land
      once the team answers.
    </p>
  );
}
