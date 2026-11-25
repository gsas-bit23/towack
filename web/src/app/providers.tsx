"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { MotionConfig } from "motion/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/config/wagmi";
import { ViewChainProvider } from "@/lib/chain";
import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { LocaleProvider, useLocale } from "@/lib/i18n";

// RainbowKit in the Signal palette: ink surfaces, hairline borders, lime accent.
const theme = darkTheme({
  accentColor: "#C6F432",
  accentColorForeground: "#070A03",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});
theme.colors.modalBackground = "#0D101B";
theme.colors.modalBorder = "#262E46";
theme.colors.modalText = "#EEF1F8";
theme.colors.modalTextSecondary = "#7F89A3";
theme.colors.modalTextDim = "#5B6582";
theme.colors.generalBorder = "#1A2032";
theme.colors.generalBorderDim = "#141A2A";
theme.colors.menuItemBackground = "#141A2A";
theme.colors.actionButtonSecondaryBackground = "#141A2A";
theme.colors.closeButton = "#B0B8CC";
theme.colors.closeButtonBackground = "#141A2A";
theme.colors.connectButtonBackground = "#0D101B";
theme.colors.connectButtonInnerBackground = "#141A2A";
theme.colors.connectButtonText = "#EEF1F8";
theme.colors.profileForeground = "#0D101B";
theme.colors.modalBackdrop = "rgba(3, 4, 10, 0.75)";
theme.colors.error = "#FF4D6D";
theme.colors.connectionIndicator = "#2FE3A0";
theme.fonts.body = "var(--font-geist), ui-sans-serif, system-ui, sans-serif";
theme.shadows.dialog = "0 24px 60px -20px rgba(0, 0, 0, 0.8)";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 8_000 } } }),
  );
  return (
    <LocaleProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <LocalizedRainbowKit>
            <ViewChainProvider>
              {/* Honour prefers-reduced-motion for every motion component (transforms off, fades kept). */}
              <MotionConfig reducedMotion="user">{children}</MotionConfig>
            </ViewChainProvider>
          </LocalizedRainbowKit>
        </QueryClientProvider>
      </WagmiProvider>
    </LocaleProvider>
  );
}

/** RainbowKit's own modal copy follows the site language. */
function LocalizedRainbowKit({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  return (
    <RainbowKitProvider theme={theme} initialChain={DEFAULT_CHAIN_ID} modalSize="compact" locale={locale === "zh" ? "zh-CN" : "en-US"}>
      {children}
    </RainbowKitProvider>
  );
}
