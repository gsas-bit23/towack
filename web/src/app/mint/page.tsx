import type { Metadata } from "next";
import { InstrumentArc } from "@/components/art";
import { PageHeader } from "@/components/ui";
import { GenesisCard } from "@/components/GenesisCard";
import { MintPanel } from "./MintPanel";

export const metadata: Metadata = { title: "Mint" };

export default function MintPage() {
  return (
    <>
      <PageHeader
        kicker="Agent ID holders only · 0.1 BNB + VRF fee"
        title="Mint. Spin. See what you pull."
        art={<InstrumentArc progress={0.5} className="pointer-events-none absolute -right-[140px] -top-[120px] hidden h-[440px] w-[440px] opacity-60 md:block" />}
      >
        One mint per Agent ID wallet. 0.1 BNB (plus a small Chainlink VRF fee for your random draw) gets you 80,000 TWAK on the
        spot plus one spin of the Draw V1 prize wheel, drawn by Chainlink VRF. 5,000 slots, then the booth closes.
      </PageHeader>
      <div className="mx-auto max-w-[1220px] px-6 pt-6">
        <GenesisCard />
      </div>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-10">
        <MintPanel />
      </section>
    </>
  );
}
