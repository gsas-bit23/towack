import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { TradeDesk } from "./TradeDesk";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <>
      <PageHeader kicker="Open router · PancakeSwap v2 · Agent ID rebates" title="Swap TWAK ↔ BNB.">
        Any wallet can trade. 1% on the BNB leg, split 50/30/20 to trader rebates, the Draw V2 treasury, and dev. Rebates accrue only if your wallet
        holds an Agent ID. No token transfer tax. Exact approvals only. You set your own daily limit.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <TradeDesk />
        <p className="mt-8 rounded-3xl border-[3px] border-navy bg-white px-5 py-4 font-bold text-navy/80">
          Swapping other tokens or bridging to another chain?{" "}
          <Link href="/swap" className="underline decoration-[3px] underline-offset-4 hover:text-candy">
            Swap &amp; bridge
          </Link>{" "}
          compares PancakeSwap, Uniswap and Relay routes (no Towack rebates there).
        </p>
      </section>
    </>
  );
}
