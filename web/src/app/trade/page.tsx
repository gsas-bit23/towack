import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TradeDesk } from "./TradeDesk";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <>
      <PageHeader title={<T k="trade.title" />}>
        <T k="trade.lead" tags={{ a: { href: "/swap", className: "underline decoration-1 underline-offset-2 hover:text-gold" } }} />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <TradeDesk />
      </section>
    </>
  );
}
