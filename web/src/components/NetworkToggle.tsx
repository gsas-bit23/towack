"use client";

import { useTowack } from "@/lib/chain";
import type { SupportedChainId } from "@/config/addresses";

const OPTIONS: { id: SupportedChainId; label: string }[] = [
  { id: 97, label: "Testnet" },
  { id: 56, label: "Mainnet" },
];

export function NetworkToggle({ className = "hidden sm:flex" }: { className?: string }) {
  const { chainId, selectChain, isSwitching, wrongNetwork } = useTowack();
  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className={`items-center rounded-full border-[3px] border-navy bg-white p-0.5 text-[13px] font-black ${className}`}
    >
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
            className={`flex min-h-10 items-center gap-1.5 rounded-full px-3 transition ${
              active ? (o.id === 97 ? "bg-sky text-navy" : "bg-sun text-navy") : "text-navy/60 hover:text-navy"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${active ? "bg-navy" : "bg-navy/25"}`} aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
