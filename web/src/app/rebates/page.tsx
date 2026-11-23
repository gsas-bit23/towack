import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { RebateBooth } from "./RebateBooth";

export const metadata: Metadata = { title: "Rebates" };

export default function RebatesPage() {
  return (
    <>
      <PageHeader kicker="Weekly epochs · 104 weeks" title="Trader rebates.">
        Rebates come from trading through the Towack router — not sit-and-earn staking. Each week, 100M ÷ 104 TWAK plus the 50% BNB fee share is split
        pro-rata to the router fees each trader paid that week. No trades, no rebate.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <RebateBooth />
      </section>
    </>
  );
}
