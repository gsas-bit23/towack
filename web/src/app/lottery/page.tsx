import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LotteryBooth } from "./LotteryBooth";

export const metadata: Metadata = { title: "Lottery" };

export default function LotteryPage() {
  return (
    <>
      <PageHeader kicker="Draw V2 · MVP" title="Weekly ticket rounds." tone="candy">
        Burn TWAK for tickets — about $1 of TWAK per ticket. Once a week, one VRF draw picks one winner weighted by tickets. Burned TWAK is gone for good,
        and most tickets win nothing.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <LotteryBooth />
      </section>
    </>
  );
}
