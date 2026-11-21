"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/config/wagmi";
import { ViewChainProvider } from "@/lib/chain";
import { DEFAULT_CHAIN_ID } from "@/config/chains";

const theme = lightTheme({
  accentColor: "#FF4FA3",
  accentColorForeground: "#FFFFFF",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});
theme.colors.modalBackground = "#EEF8FF";
theme.colors.modalText = "#13204A";
theme.colors.modalBorder = "#13204A";
theme.fonts.body = "var(--font-nunito), system-ui, sans-serif";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 8_000 } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={DEFAULT_CHAIN_ID} modalSize="compact">
          <ViewChainProvider>{children}</ViewChainProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
