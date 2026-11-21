import type { Metadata } from "next";
import { BonusBars, BnbTierStubs } from "@/components/PrizeTables";
import { PageHeader, Panel } from "@/components/ui";
import { DrawMachine } from "./DrawMachine";

export const metadata: Metadata = { title: "Draw" };

export default function DrawPage() {
  return (
    <>
      <PageHeader kicker="Draw V1 · Chainlink VRF v2.5" title="The draw machine." tone="candy">
        One random seed assigns every slot at once from fixed prize tables. Nobody can pick winners, and the contract has no owner. Prizes are not
        guaranteed — many slots win nothing.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <DrawMachine />
        <Panel>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-[28px] font-extrabold">BNB prize tickets at sellout (5,000 mints)</h2>
            <div className="checker hidden h-6 w-[120px] rounded-md opacity-90 md:block" aria-hidden="true" />
          </div>
          <BnbTierStubs />
          <p className="mt-5 font-semibold text-navy/70">
            If fewer than 5,000 mint, each tier shrinks to floor(minted × slots ÷ 5,000) and the rest get no BNB prize. Total BNB prizes at sellout: 175
            BNB from 500 BNB of mint proceeds.
          </p>
        </Panel>
        <Panel tone="candyPale" shadow={false}>
          <h2 className="font-display text-[28px] font-extrabold">Bonus round: extra TWAK at sellout</h2>
          <p className="mt-1 font-semibold text-navy/70">
            Drawn from the 50M Draw V1 bonus reserve with a separate shuffle. 1,020 winners at sellout; unused reserve is burned. You can win a BNB
            refund, a token bonus, both, or neither.
          </p>
          <BonusBars />
        </Panel>
      </section>
    </>
  );
}
