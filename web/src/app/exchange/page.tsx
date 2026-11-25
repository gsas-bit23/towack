import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ExchangeApp } from "./ExchangeApp";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Agent Exchange" };

export default function ExchangePage() {
  return (
    <>
      <PageHeader title={<T k="ex.title" />}>
        <T k="ex.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <ExchangeApp />
      </section>
    </>
  );
}
