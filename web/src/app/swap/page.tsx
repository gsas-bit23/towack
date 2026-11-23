import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { SwapDesk } from "./SwapDesk";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Swap & bridge" };

export default function SwapPage() {
  return (
    <>
      <PageHeader kicker={<T k="swap.kicker" />} title={<T k="swap.title" />}>
        <T k="swap.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <SwapDesk />
      </section>
    </>
  );
}
