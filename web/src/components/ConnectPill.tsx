"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

const PILL_BASE =
  "press rounded-full text-white font-extrabold whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun";
const PILL_FULL = "text-[15px] px-5 py-3 min-h-10";
const PILL_COMPACT = "text-[14px] px-4 py-2.5 min-h-10 sm:px-5 sm:text-[15px]";

/** `compact`: smaller pill for the top bar; shows just "Connect" on phones. */
export function ConnectPill({ label = "Connect wallet", compact = false }: { label?: string; compact?: boolean }) {
  const cls = `${PILL_BASE} ${compact ? PILL_COMPACT : PILL_FULL}`;
  const normal = `${cls} bg-navy shadow-[0_5px_0_#FF4FA3]`;
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
            <button type="button" onClick={openChainModal} className={`${cls} bg-candy shadow-[0_5px_0_#13204A]`}>
              Wrong network
            </button>
          );
        }
        return (
          <button type="button" onClick={openAccountModal} className={`${normal} max-w-[44vw] truncate sm:max-w-none`}>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-sun align-middle" aria-hidden="true" />
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
