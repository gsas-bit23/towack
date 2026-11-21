import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { MintPanel } from "./MintPanel";

export const metadata: Metadata = { title: "Mint" };

export default function MintPage() {
  return (
    <>
      <PageHeader kicker="Agent ID holders only · 0.1 BNB" title="Mint your slot.">
        One mint per Agent ID wallet. Exactly 0.1 BNB gets you 80,000 TWAK on the spot plus one seat in the Draw V1 prize booth. 5,000 slots, then the
        machine closes.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <MintPanel />
      </section>
    </>
  );
}
