import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { DrawMachine } from "./DrawMachine";

export const metadata: Metadata = { title: "Prize booth" };

export default function DrawPage() {
  return (
    <>
      <PageHeader kicker="Draw V1 · Chainlink VRF v2.5 · one spin per mint" title="The prize booth." tone="candy">
        Every mint gets its own Chainlink VRF random word, and the contract pops one slot from a fixed 5,000-slot deck. One outcome per spin: a BNB
        refund, a TWAK bonus, or better luck next time. Nobody can pick winners, and the contract has no owner. Prizes are not guaranteed.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <DrawMachine />
        <Panel tone="skyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">How the deck works</h2>
          <ul className="mt-3 space-y-2 font-bold text-navy/80">
            <li>★ The deck always starts at 5,000 slots: 3,500 BNB refunds (500 full, 600 × 75%, 800 × 50%, 1,600 × 25%), 1,020 TWAK bonuses (20 × 5×,
              40 × 3×, 80 × 2×, 160 × 1.5×, 320 × 1.25×, 400 × 1.1×) and 480 “better luck next time”.</li>
            <li>★ Each VRF answer picks one remaining slot uniformly (random word mod slots left) and removes it. The odds shift as the deck empties.</li>
            <li>★ At a full 5,000 sellout the prize pool is 166.25 BNB of refunds and 35.2M TWAK of bonuses. Assigned refunds stay in escrow until claimed.</li>
            <li>★ If the mint ends early, undrawn slots are unsold: their BNB goes to liquidity / Draw V2 and their bonus TWAK is burned.</li>
            <li>★ This is a game of chance, not an investment. Most spins get back less than the 0.1 BNB paid.</li>
          </ul>
        </Panel>
      </section>
    </>
  );
}
