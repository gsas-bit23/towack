import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TradeDesk } from "./TradeDesk";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <>
      <PageHeader kicker={<T k="trade.kicker" />} title={<T k="trade.title" />}>
        <T k="trade.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <TradeDesk />
        <p className="mt-8 rounded-2xl border border-line bg-card px-5 py-4 font-medium text-sub">
          <T k="trade.otherTokens" tags={{ a: { href: "/swap", className: "underline decoration-[3px] underline-offset-4 hover:text-gold" } }} />
        </p>
      </section>
    </>
  );
}
