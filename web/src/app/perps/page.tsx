import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { PerpsDesk } from "./PerpsDesk";

export const metadata: Metadata = { title: "Perps" };

export default function PerpsPage() {
  return (
    <>
      <PageHeader kicker="Aster perpetuals · live public data · you sign" title="Perps on Aster." tone="candy">
        Live Aster perpetual markets, mark prices and funding, read straight from Aster&apos;s public API with no key. Trade with a trade-only Aster API
        wallet that your own wallet approves and that stays in your browser. Towack never holds a key and adds no fee.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-4 pb-16 pt-6 sm:px-6">
        <PerpsDesk />
      </section>
    </>
  );
}
