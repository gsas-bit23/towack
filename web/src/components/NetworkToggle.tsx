"use client";

import { useTowack } from "@/lib/chain";
import type { SupportedChainId } from "@/config/addresses";

const OPTIONS: { id: SupportedChainId; label: string }[] = [
  { id: 97, label: "Testnet" },
  { id: 56, label: "Mainnet" },
];

/** BSC network switch styled as the Atlas network pill (gold dot = active chain). */
export function NetworkToggle({ className = "hidden sm:flex" }: { className?: string }) {
  const { chainId, selectChain, isSwitching, wrongNetwork } = useTowack();
  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className={`h-9 items-center gap-0.5 rounded-full border border-line-2 p-0.5 text-[13px] font-medium ${className}`}
    >
      <span className="px-2 text-[12px] font-semibold text-sub">BSC</span>
      {OPTIONS.map((o) => {
        const active = !wrongNetwork && chainId === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={isSwitching}
            onClick={() => selectChain(o.id)}
            className={`flex h-full items-center gap-1.5 rounded-full px-2.5 transition-colors ${
              active ? "bg-card-2 text-fg" : "text-muted hover:text-fg"
            }`}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${active ? (o.id === 56 ? "bg-gold" : "bg-up") : "bg-line-2"}`} aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
