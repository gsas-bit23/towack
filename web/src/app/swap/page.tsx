import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { SwapDesk } from "./SwapDesk";

export const metadata: Metadata = { title: "Swap & bridge" };

export default function SwapPage() {
  return (
    <>
      <PageHeader kicker="Relay · PancakeSwap · Uniswap · best-route quotes" title="Swap any token. Bridge out.">
        Compare live quotes from PancakeSwap, Uniswap and Relay, pick the best net output, and sign it in your own wallet. BNB Chain first; Relay bridges
        to Ethereum, Base, Arbitrum, Optimism and Polygon. Exact approvals only. Anyone can use it.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <SwapDesk />
      </section>
    </>
  );
}
