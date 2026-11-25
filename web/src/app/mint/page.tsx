import type { Metadata } from "next";
import { GenesisCard } from "@/components/GenesisCard";
import { PageHeader } from "@/components/ui";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Genesis 300" };

// The paid mint closed with no mints and its allocation was burned; Genesis 300 (free, gas-only) is the way in.
export default function MintPage() {
  return (
    <>
      <PageHeader sys="TWAK://GENESIS" title={<T k="mint.title" />}>
        <T k="mint.lead" />
      </PageHeader>
      <div className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <GenesisCard />
      </div>
    </>
  );
}
