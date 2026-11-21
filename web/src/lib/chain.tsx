"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ADDRESSES, type AddressBook, type ContractKey, type SupportedChainId } from "@/config/addresses";
import { CHAIN_META, DEFAULT_CHAIN_ID, isSupportedChain } from "@/config/chains";

type Ctx = { viewChainId: SupportedChainId; setViewChainId: (id: SupportedChainId) => void };
const ViewChainContext = createContext<Ctx>({ viewChainId: DEFAULT_CHAIN_ID, setViewChainId: () => {} });

export function ViewChainProvider({ children }: { children: ReactNode }) {
  const [viewChainId, setViewChainId] = useState<SupportedChainId>(DEFAULT_CHAIN_ID);
  const value = useMemo(() => ({ viewChainId, setViewChainId }), [viewChainId]);
  return <ViewChainContext.Provider value={value}>{children}</ViewChainContext.Provider>;
}

/**
 * The chain the UI reads from: the wallet's chain when it is connected to BSC / BSC testnet,
 * otherwise the chain picked in the network toggle (default from NEXT_PUBLIC_DEFAULT_CHAIN_ID).
 */
export function useTowack() {
  const { viewChainId, setViewChainId } = useContext(ViewChainContext);
  const { chainId: walletChainId, isConnected, address } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const wrongNetwork = isConnected && !isSupportedChain(walletChainId);
  const chainId: SupportedChainId = isConnected && isSupportedChain(walletChainId) ? walletChainId : viewChainId;
  const addresses: AddressBook = ADDRESSES[chainId];

  const selectChain = useCallback(
    (id: SupportedChainId) => {
      setViewChainId(id);
      // Switching networks is a wallet prompt, never a transaction; the user approves it in their wallet.
      if (isConnected && walletChainId !== id) switchChain({ chainId: id });
    },
    [isConnected, walletChainId, setViewChainId, switchChain],
  );

  const has = useCallback((...keys: ContractKey[]) => keys.every((k) => Boolean(addresses[k])), [addresses]);

  return {
    chainId,
    meta: CHAIN_META[chainId],
    addresses,
    has,
    account: address,
    isConnected,
    wrongNetwork,
    selectChain,
    isSwitching,
  };
}
