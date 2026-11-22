import type { Metadata } from "next";
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
      </section>
    </>
  );
}
