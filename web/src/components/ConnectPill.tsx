"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

const PILL =
  "press rounded-full bg-navy text-white font-extrabold text-[15px] px-5 py-3 shadow-[0_5px_0_#FF4FA3] whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun";

export function ConnectPill({ label = "Connect wallet" }: { label?: string }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!ready) {
          return (
            <button type="button" className={`${PILL} opacity-0`} aria-hidden="true" tabIndex={-1}>
              {label}
            </button>
          );
        }
        if (!connected) {
          return (
            <button type="button" onClick={openConnectModal} className={PILL}>
              {label}
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" onClick={openChainModal} className={`${PILL} bg-candy shadow-[0_5px_0_#13204A]`}>
              Wrong network
            </button>
          );
        }
        return (
          <button type="button" onClick={openAccountModal} className={PILL}>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-sun align-middle" aria-hidden="true" />
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
