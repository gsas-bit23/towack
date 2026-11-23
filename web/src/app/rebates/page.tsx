import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { RebateBooth } from "./RebateBooth";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Rebates" };

export default function RebatesPage() {
  return (
    <>
      <PageHeader kicker={<T k="reb.kicker" />} title={<T k="reb.title" />}>
        <T k="reb.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <RebateBooth />
      </section>
    </>
  );
}
