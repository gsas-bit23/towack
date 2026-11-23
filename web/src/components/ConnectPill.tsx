"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

const BASE =
  "press inline-flex items-center justify-center rounded-[10px] border font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60";
const FULL = "h-11 px-5 text-[14.5px]";
const COMPACT = "h-10 px-3.5 text-[13.5px] sm:px-4 sm:text-[14px]";

/** `compact`: Atlas outline button for the top bar (shows just "Connect" on phones). Full size = the gold in-page CTA. */
export function ConnectPill({ label = "Connect wallet", compact = false }: { label?: string; compact?: boolean }) {
  const cls = `${BASE} ${compact ? COMPACT : FULL}`;
  const normal = compact
    ? `${cls} border-line-2 bg-transparent text-fg hover:border-[#4A525E] hover:bg-card`
    : `${cls} border-transparent bg-gold text-on-gold hover:bg-gold-2`;
  const connectedCls = `${cls} border-line-2 bg-card text-fg hover:bg-card-2`;
  const text = compact ? (
    <>
      <span className="sm:hidden">Connect</span>
      <span className="hidden sm:inline">{label}</span>
    </>
  ) : (
    label
  );
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!ready) {
          return (
            <button type="button" className={`${normal} opacity-0`} aria-hidden="true" tabIndex={-1}>
              {text}
            </button>
          );
        }
        if (!connected) {
          return (
            <button type="button" onClick={openConnectModal} className={normal}>
              {text}
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className={`${cls} border-down/40 bg-down/10 text-down`}>
              Wrong network
            </button>
          );
        }
        return (
          <button type="button" onClick={openAccountModal} className={`${connectedCls} max-w-[44vw] truncate font-mono sm:max-w-none`}>
            <span className="mr-2 inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-up" aria-hidden="true" />
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
