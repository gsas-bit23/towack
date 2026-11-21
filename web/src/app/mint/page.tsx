import type { Metadata } from "next";
import { LabelTicket, TwCoin } from "@/components/art";
import { PageHeader } from "@/components/ui";
import { MintPanel } from "./MintPanel";

export const metadata: Metadata = { title: "Mint" };

export default function MintPage() {
  return (
    <>
      <PageHeader
        kicker="Agent ID holders only · 0.1 BNB"
        title="Mint. Spin. See what you pull."
        art={
          <>
            <TwCoin className="bounce absolute right-[60px] top-[40px] hidden w-[96px] lg:block" />
            <LabelTicket label="SPIN!" className="bounce bounce-2 absolute bottom-[34px] right-[190px] hidden w-[150px] lg:block" style={{ ["--r" as string]: "-10deg" }} fontSize={40} />
          </>
        }
      >
        One mint per Agent ID wallet. Exactly 0.1 BNB gets you 80,000 TWAK on the spot plus one spin of the Draw V1 prize wheel, drawn by Chainlink
        VRF. 5,000 slots, then the booth closes.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <MintPanel />
      </section>
    </>
  );
}
