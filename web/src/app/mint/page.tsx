import type { Metadata } from "next";
import { InstrumentArc } from "@/components/art";
import { ButtonLink, PageHeader } from "@/components/ui";
import { GenesisCard } from "@/components/GenesisCard";
import { MintPanel } from "./MintPanel";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Mint" };

export default function MintPage() {
  return (
    <>
      <PageHeader
        title={<T k="mint.title" />}
        art={<InstrumentArc progress={0.5} className="pointer-events-none absolute -right-[140px] -top-[120px] hidden h-[440px] w-[440px] opacity-60 md:block" />}
      >
        <T k="mint.lead" />
        {/* Two ways to mint on one page: make both easy to reach (each has its own AI-agent instruction). */}
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="#genesis" tone="line" size="md">
            <T k="mint.jumpFree" />
          </ButtonLink>
          <ButtonLink href="#paid-mint" tone="gold" size="md">
            <T k="mint.jumpPaid" />
          </ButtonLink>
        </div>
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
