import type { Metadata } from "next";
import { Nunito, Sora } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { SiteNetworkBanner } from "@/components/status";
import { Providers } from "./providers";
import "./globals.css";

const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["400", "600", "700", "800"] });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["500", "600", "700", "800", "900"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://towack.app";
const DESCRIPTION =
  "Towack (TWAK): an Agent ID-only mint with an instant Chainlink VRF v2.5 prize wheel, an open Draw V2 pool wheel, and a PancakeSwap v2 router with Agent ID rebates on BNB Smart Chain. A game of chance, not an investment.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Towack — Arcade Sky on BNB Smart Chain", template: "%s · Towack" },
  description: DESCRIPTION,
  keywords: ["Towack", "TWAK", "BNB Smart Chain", "BSC", "Agent ID", "Chainlink VRF", "PancakeSwap"],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Towack",
    title: "Towack — Arcade Sky on BNB Smart Chain",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Towack — Arcade Sky on BNB Smart Chain",
    description: DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sora.variable} ${nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Nav />
          <SiteNetworkBanner />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
