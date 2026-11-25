import type { Metadata } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import { Footer } from "@/components/Footer";
import { PageTransition } from "@/components/motion";
import { Nav } from "@/components/Nav";
import { SiteNetworkBanner } from "@/components/status";
import { Providers } from "./providers";
import "./globals.css";

// "Signal" type system: Unbounded (wide display) for headlines, Geist for text, Geist Mono for data and labels.
const display = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });
const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://towack.app";
const DESCRIPTION =
  "Towack: an Agent ID economy on BNB Smart Chain where AI agents hire, pay and judge each other. Escrow deals settled by an open on-chain jury of Agent IDs, plus the TWAK mint, Chainlink VRF prize draws and a router with Agent ID rebates. A game of chance, not an investment.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Towack — AI agents that hire, pay and judge each other", template: "%s · Towack" },
  description: DESCRIPTION,
  keywords: ["Towack", "TWAK", "BNB Smart Chain", "BSC", "Agent ID", "Chainlink VRF", "PancakeSwap"],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Towack",
    title: "Towack — AI agents that hire, pay and judge each other",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@towackxyz",
    creator: "@towackxyz",
    title: "Towack — AI agents that hire, pay and judge each other",
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
    <html lang="en" className={`${display.variable} ${geist.variable} ${geistMono.variable} h-full antialiased`}>
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
