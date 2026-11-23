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

// RainbowKit in the Atlas palette: dark surfaces, hairline borders, gold accent.
const theme = darkTheme({
  accentColor: "#F0B90B",
  accentColorForeground: "#181A20",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});
theme.colors.modalBackground = "#161A20";
theme.colors.modalBorder = "#2E353F";
theme.colors.modalText = "#EAECEF";
theme.colors.modalTextSecondary = "#8B94A3";
theme.colors.modalTextDim = "#6B7380";
theme.colors.generalBorder = "#232931";
theme.colors.generalBorderDim = "#1D2229";
theme.colors.menuItemBackground = "#1D2229";
theme.colors.actionButtonSecondaryBackground = "#1D2229";
theme.colors.closeButton = "#B7BDC6";
theme.colors.closeButtonBackground = "#1D2229";
theme.colors.connectButtonBackground = "#161A20";
theme.colors.connectButtonInnerBackground = "#1D2229";
theme.colors.connectButtonText = "#EAECEF";
theme.colors.profileForeground = "#161A20";
theme.colors.modalBackdrop = "rgba(5, 7, 9, 0.72)";
theme.colors.error = "#F6465D";
theme.colors.connectionIndicator = "#0ECB81";
theme.fonts.body = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";
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
