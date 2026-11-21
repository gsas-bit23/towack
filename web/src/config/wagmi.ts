import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { binanceWallet, injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";
import { DEFAULT_CHAIN_ID, RPC_URLS } from "./chains";

/**
 * WalletConnect needs a project id from https://cloud.reown.com. Without one we only offer injected
 * wallets (browser extensions, and in-app browsers such as the Binance app, which inject a provider).
 * Binance Wallet's RainbowKit connector falls back to WalletConnect when it is not injected, so it
 * is only listed when a project id is configured.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
export const HAS_WALLETCONNECT = WALLETCONNECT_PROJECT_ID.length > 0;

const connectors = connectorsForWallets(
  HAS_WALLETCONNECT
    ? [
        { groupName: "Popular", wallets: [injectedWallet, binanceWallet] },
        { groupName: "More", wallets: [walletConnectWallet] },
      ]
    : [{ groupName: "Browser wallet", wallets: [injectedWallet] }],
  { appName: "Towack", projectId: WALLETCONNECT_PROJECT_ID },
);

// Default chain goes first so wagmi treats it as the initial chain.
const chains = DEFAULT_CHAIN_ID === 56 ? ([bsc, bscTestnet] as const) : ([bscTestnet, bsc] as const);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [bscTestnet.id]: http(RPC_URLS[97]),
    [bsc.id]: http(RPC_URLS[56]),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
