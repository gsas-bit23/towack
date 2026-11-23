import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { DrawMachine } from "./DrawMachine";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Prize booth" };

const DECK_ROWS = ["draw.deck1", "draw.deck2", "draw.deck3", "draw.deck4", "draw.deck5"] as const;

export default function DrawPage() {
  return (
    <>
      <PageHeader kicker={<T k="draw.kicker" />} title={<T k="draw.title" />}>
        <T k="draw.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <DrawMachine />
        <Panel tone="raised" shadow={false}>
          <h2 className="font-display text-[24px] font-semibold">
            <T k="draw.deckHow" />
          </h2>
          <ul className="mt-3 space-y-2 font-medium text-sub">
            {DECK_ROWS.map((k) => (
              <li key={k} className="flex gap-2.5">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span>
                  <T k={k} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </>
  );
}
