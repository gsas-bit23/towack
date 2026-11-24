import type { Metadata } from "next";
import { TokenomicsChart } from "@/components/TokenomicsChart";
import { SPLIT, SPLIT_TOTAL, splitKey } from "@/lib/tokenomics";
import { T, type MessageKey } from "@/lib/i18n";
import { PageHeader, Panel } from "@/components/ui";
import { VestingPanel } from "./VestingPanel";

export const metadata: Metadata = { title: "Tokenomics" };

export default function TokenomicsPage() {
  return (
    <>
      <PageHeader title={<T k="tok.title" />}>
        <T k="tok.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <Panel>
          <TokenomicsChart />
        </Panel>

        <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
          <Panel className="col-span-12 lg:col-span-7" shadow={false}>
            <h2 className="font-display text-[28px] font-semibold">
              <T k="tok.full" />
            </h2>
            <table className="mt-4 w-full text-left font-medium">
              <thead className="text-[12px] uppercase tracking-widest text-muted">
                <tr>
                  <th className="py-2">
                    <T k="tok.bucket" />
                  </th>
                  <th className="py-2 text-right">
                    <T k="tok.share" />
                  </th>
                  <th className="py-2 text-right">TWAK</th>
                </tr>
              </thead>
              <tbody>
                {SPLIT.map((s, i) => (
                  <tr key={s.label} className="border-t border-line-2">
                    <td className="py-2.5">
                      <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border border-line align-middle" style={{ background: s.color }} />
                      <T k={splitKey(i)} />
                    </td>
                    <td className="py-2.5 text-right font-display font-semibold">{s.pct}%</td>
                    <td className="py-2.5 text-right">{(s.pct * 10_000_000).toLocaleString("en-US")}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="py-2.5 font-display font-semibold">
                    <T k="tok.total" />
                  </td>
                  <td className="py-2.5 text-right font-display font-semibold">{SPLIT_TOTAL}%</td>
                  <td className="py-2.5 text-right">{(SPLIT_TOTAL * 10_000_000).toLocaleString("en-US")}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
          <div className="col-span-12 space-y-6 lg:col-span-5">
            <Panel tone="raised" shadow={false}>
              <span className="rounded-full bg-card-2 px-3 py-1 text-sm font-semibold text-fg">
                <T k="tok.listing" />
              </span>
              <p className="mt-3 font-medium text-sub">
                <T k="tok.listingBody" />
              </p>
            </Panel>
            <Panel tone="raised" shadow={false}>
              <h3 className="font-display text-[22px] font-semibold">
                <T k="tok.burned" />
              </h3>
              <ul className="mt-2 space-y-1.5 font-medium text-sub">
                {[1, 2, 3, 4].map((n) => (
                  <li key={n} className="flex gap-2.5">
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    <span>
                      <T k={`tok.burn${n}` as MessageKey} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <VestingPanel />
      </section>
    </>
  );
}
