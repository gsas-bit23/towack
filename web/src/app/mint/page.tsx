import type { Metadata } from "next";
import { InstrumentArc } from "@/components/art";
import { PageHeader } from "@/components/ui";
import { GenesisCard } from "@/components/GenesisCard";
import { MintPanel } from "./MintPanel";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Mint" };

export default function MintPage() {
  return (
    <>
      <PageHeader
        kicker={<T k="mint.kicker" />}
        title={<T k="mint.title" />}
        art={<InstrumentArc progress={0.5} className="pointer-events-none absolute -right-[140px] -top-[120px] hidden h-[440px] w-[440px] opacity-60 md:block" />}
      >
        <T k="mint.lead" />
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
