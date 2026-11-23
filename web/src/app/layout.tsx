import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Footer } from "@/components/Footer";
import { PageTransition } from "@/components/motion";
import { Nav } from "@/components/Nav";
import { SiteNetworkBanner } from "@/components/status";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://towack.app";
const DESCRIPTION =
  "Towack (TWAK): an Agent ID-only mint with an instant Chainlink VRF v2.5 prize wheel, an open Draw V2 pool wheel, and a PancakeSwap v2 router with Agent ID rebates on BNB Smart Chain. A game of chance, not an investment.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Towack — Agent ID markets on BNB Chain", template: "%s · Towack" },
  description: DESCRIPTION,
  keywords: ["Towack", "TWAK", "BNB Smart Chain", "BSC", "Agent ID", "Chainlink VRF", "PancakeSwap"],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Towack",
    title: "Towack — Agent ID markets on BNB Chain",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@towackxyz",
    creator: "@towackxyz",
    title: "Towack — Agent ID markets on BNB Chain",
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
    <html lang="en" className={`${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Nav />
          <SiteNetworkBanner />
          <main className="flex-1">
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
