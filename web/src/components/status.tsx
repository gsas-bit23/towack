"use client";

import type { ReactNode } from "react";
import type { ContractKey } from "@/config/addresses";
import { useTowack } from "@/lib/chain";
import type { TxState } from "@/lib/tx";
import { ConnectPill } from "./ConnectPill";
import { LabelTicket } from "./art";
import { Button } from "./ui";

const KEY_LABEL: Record<ContractKey, string> = {
  agentId: "Agent ID registry",
  token: "TWAK token",
  launch: "Launch / mint",
  router: "Towack router",
  rebateDistributor: "Rebate distributor",
  teamVesting: "Team vesting",
  drawV2: "Draw V2",
  timelock: "Timelock",
  wbnb: "WBNB",
  pancakeRouter: "PancakeSwap router",
  pancakeFactory: "PancakeSwap factory",
};

export function DeployingSoon({ keys, children }: { keys: ContractKey[]; children?: ReactNode }) {
  const { meta, addresses } = useTowack();
  const missing = keys.filter((k) => !addresses[k]);
  return (
    <div className="relative overflow-hidden rounded-[40px] border-4 border-dashed border-navy bg-sun-pale p-8 text-center">
      <LabelTicket label="SOON" className="wiggle mx-auto w-[180px]" fill="#FFCD2E" fontSize={40} />
      <h3 className="mt-4 font-display text-[34px] font-extrabold leading-tight">Contracts deploying soon</h3>
      <p className="mx-auto mt-2 max-w-[560px] font-bold text-navy/75">
        The Towack contracts are not live on {meta.name} yet, so this machine is switched off. Nothing to sign, nothing to
        send. Check back after the testnet deploy.
      </p>
      {missing.length > 0 ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {missing.map((k) => (
            <span key={k} className="rounded-full border-[3px] border-navy bg-white px-3 py-1 text-xs font-black">
              {KEY_LABEL[k]}: not set
            </span>
          ))}
        </div>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** Renders children only when every listed contract address is configured for the current chain. */
export function NeedsContracts({ keys, children, soon }: { keys: ContractKey[]; children: ReactNode; soon?: ReactNode }) {
  const { has } = useTowack();
  if (!has(...keys)) return <DeployingSoon keys={keys}>{soon}</DeployingSoon>;
  return <>{children}</>;
}

export function NeedsWallet({ children, why }: { children: ReactNode; why?: string }) {
  const { isConnected, wrongNetwork, selectChain, chainId } = useTowack();
  if (!isConnected) {
    return (
      <div className="rounded-[32px] border-4 border-navy bg-ice p-7 text-center">
        <p className="font-display text-[22px] font-extrabold">Connect your wallet to play</p>
        <p className="mt-1 font-bold text-navy/70">{why ?? "Every action is signed in your own wallet. We never see your keys."}</p>
        <div className="mt-5 flex justify-center">
          <ConnectPill />
        </div>
      </div>
    );
  }
  if (wrongNetwork) {
    return (
      <div className="rounded-[32px] border-4 border-navy bg-candy-pale p-7 text-center">
        <p className="font-display text-[22px] font-extrabold">Wrong network</p>
        <p className="mt-1 font-bold text-navy/70">Towack runs on BNB Smart Chain. Switch in your wallet to continue.</p>
        <div className="mt-5 flex justify-center">
          <Button tone="sun" size="sm" onClick={() => selectChain(chainId)}>
            Switch network
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
    <a href={`${meta.explorer}/address/${address}`} target="_blank" rel="noreferrer" className="font-mono text-sm underline decoration-2 underline-offset-2 hover:text-candy">
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
