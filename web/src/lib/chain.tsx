"use client";

import { useCallback, type ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ADDRESSES, type AddressBook, type ContractKey } from "@/config/addresses";
import { APP_CHAIN_ID, CHAIN_META, isAppChain, type AppChainId } from "@/config/chains";

/** Kept so the provider tree stays stable; the app has a single chain, so there is no view state to hold. */
export function ViewChainProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * The chain the UI reads from: always BNB Smart Chain mainnet (56). A wallet on any other network
 * (including BSC testnet) is flagged as `wrongNetwork` and asked to switch to BNB Chain.
 */
export function useTowack() {
  const { chainId: walletChainId, isConnected, address } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const wrongNetwork = isConnected && !isAppChain(walletChainId);
  const chainId: AppChainId = APP_CHAIN_ID;
  const addresses: AddressBook = ADDRESSES[APP_CHAIN_ID];

  // Switching networks is a wallet prompt, never a transaction; the user approves it in their wallet.
  const switchToApp = useCallback(() => switchChain({ chainId: APP_CHAIN_ID }), [switchChain]);

  const has = useCallback((...keys: ContractKey[]) => keys.every((k) => Boolean(addresses[k])), [addresses]);

  return {
    chainId,
    meta: CHAIN_META,
    addresses,
    has,
    account: address,
    isConnected,
    wrongNetwork,
    switchToApp,
    isSwitching,
  };
}
