import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { T, type MessageKey } from "@/lib/i18n";

export const metadata: Metadata = { title: "Docs & FAQ" };

const k = (s: string) => s as MessageKey;
const HOWTO = [1, 2, 3, 4, 5, 6];
const FAQ = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SAFETY = [1, 2, 3, 4, 5];
const PROVIDERS: [string, MessageKey][] = [
  ["PancakeSwap v3", "swap.pv.v3"],
  ["PancakeSwap v2", "swap.pv.v2"],
  ["Uniswap v3", "swap.pv.v3"],
  ["Relay", "swap.pv.relay"],
  ["0x / 1inch", "swap.pv.agg"],
];
const LINK = "underline decoration-2 underline-offset-2 hover:text-gold";
const RICH_LINK = "inline-flex min-h-10 items-center underline decoration-2 underline-offset-2 hover:text-gold";

export default function DocsPage() {
  return (
    <>
      <PageHeader sys="SYS://DOCS" title={<T k="docs.title" />}>
        <T k="docs.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <div id="risks" className="scroll-mt-24 rounded-2xl border border-line bg-gold/10 p-6 text-fg sm:p-8">
          <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-fg">
            <T k="docs.riskPill" />
          </span>
          <p className="mt-4 text-[17px] font-medium leading-relaxed sm:text-[19px]">
            <T k="risk.base" />
          </p>
        </div>

        <div>
          <h2 className="font-display text-[30px] font-semibold sm:text-[34px]">
            <T k="docs.howToPlay" />
          </h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {HOWTO.map((n) => (
              <Panel key={n} shadow={false}>
                <div className="grid h-14 w-14 rotate-[-4deg] place-items-center rounded-2xl border border-line bg-gold/15 font-display text-[26px] font-semibold">
                  {n}
                </div>
                <h3 className="mt-4 font-display text-[22px] font-semibold">
                  <T k={k(`docs.h${n}`)} />
                </h3>
                <p className="mt-2 font-semibold text-sub">
                  <T k={k(`docs.h${n}b`)} />
                </p>
              </Panel>
            ))}
          </div>
        </div>

        <Panel id="swap" shadow={false} className="scroll-mt-24">
          <h2 className="font-display text-[24px] font-semibold">
            <T k="docs.swapTitle" />
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 font-medium text-sub">
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>
                <T k={k(`swap.how${n}`)} tags={{ b: "font-semibold text-fg" }} />
              </li>
            ))}
          </ol>
          <h3 className="mt-6 font-semibold">
            <T k="docs.swapProviders" />
          </h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 font-medium text-sub sm:grid-cols-2">
            {PROVIDERS.map(([name, what]) => (
              <li key={name}>
                <span className="text-fg">{name}</span> · <T k={what} />
              </li>
            ))}
          </ul>
        </Panel>

        <div>
          <h2 className="font-display text-[30px] font-semibold sm:text-[34px]">
            <T k="docs.faq" />
          </h2>
          <div className="mt-6 space-y-4">
            {FAQ.map((n) => (
              <details key={n} className="group rounded-2xl border border-line bg-card p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[20px] font-semibold">
                  <T k={k(`docs.q${n}`)} />
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-card-2 transition group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 font-semibold text-sub">
                  <T k={k(`docs.a${n}`)} tags={{ a: { href: "https://x.com/towackxyz", className: LINK } }} />
                </p>
              </details>
            ))}
          </div>
        </div>

        <Panel tone="raised" shadow={false}>
          <h2 className="font-display text-[24px] font-semibold">
            <T k="docs.safety" />
          </h2>
          <ul className="mt-3 grid gap-2 font-medium text-sub md:grid-cols-2">
            {SAFETY.map((n) => (
              <li key={n} className="flex gap-2.5">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span>
                  <T k={k(`docs.s${n}`)} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-1 font-semibold text-sub">
            <T k="docs.ready" tags={{ a: { href: "/mint", className: RICH_LINK }, b: { href: "/exchange", className: RICH_LINK } }} />
          </p>
        </Panel>
      </section>
    </>
  );
}
