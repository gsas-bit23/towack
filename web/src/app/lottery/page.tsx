import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LotteryBooth } from "./LotteryBooth";

export const metadata: Metadata = { title: "Lottery" };

export default function LotteryPage() {
  return (
    <>
      <PageHeader kicker="Draw V2 · instant pool wheel" title="Spin the pool." tone="candy">
        Put TWAK into the prize pool and spin right away. Chainlink VRF picks a multiplier of your entry, from 0× to a 10× jackpot, paid from the pool.
        Expected return is 95%: most spins pay back less than you put in. A game of chance, not an investment.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <LotteryBooth />
      </section>
    </>
  );
}
