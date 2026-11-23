import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LotteryBooth } from "./LotteryBooth";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Lottery" };

export default function LotteryPage() {
  return (
    <>
      <PageHeader kicker={<T k="lot.kicker" />} title={<T k="lot.title" />}>
        <T k="lot.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <LotteryBooth />
      </section>
    </>
  );
}
