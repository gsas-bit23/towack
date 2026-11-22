import type { Metadata } from "next";
import { SPLIT, SPLIT_TOTAL, TokenomicsChart } from "@/components/TokenomicsChart";
import { PageHeader, Panel } from "@/components/ui";
import { VestingPanel } from "./VestingPanel";

export const metadata: Metadata = { title: "Tokenomics" };

export default function TokenomicsPage() {
  return (
    <>
      <PageHeader kicker="TWAK · 1,000,000,000 fixed supply" title="1B TWAK in the coin pusher." tone="sun">
        Minted once at deploy to fixed contracts and wallets. No owner, no mint function, no transfer tax. Holders can burn their own tokens.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <Panel>
          <TokenomicsChart />
        </Panel>

        <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
          <Panel className="col-span-12 lg:col-span-7" shadow={false}>
            <h2 className="font-display text-[28px] font-extrabold">The full split</h2>
            <table className="mt-4 w-full text-left font-bold">
              <thead className="text-[12px] uppercase tracking-widest text-navy/60">
                <tr>
                  <th className="py-2">Bucket</th>
                  <th className="py-2 text-right">Share</th>
                  <th className="py-2 text-right">TWAK</th>
                </tr>
              </thead>
              <tbody>
                {SPLIT.map((s) => (
                  <tr key={s.label} className="border-t-2 border-navy/10">
                    <td className="py-2.5">
                      <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border-2 border-navy align-middle" style={{ background: s.color }} />
                      {s.label}
                    </td>
                    <td className="py-2.5 text-right font-display font-extrabold">{s.pct}%</td>
                    <td className="py-2.5 text-right">{(s.pct * 10_000_000).toLocaleString("en-US")}</td>
                  </tr>
                ))}
                <tr className="border-t-4 border-navy">
                  <td className="py-2.5 font-display font-extrabold">Total</td>
                  <td className="py-2.5 text-right font-display font-extrabold">{SPLIT_TOTAL}%</td>
                  <td className="py-2.5 text-right">{(SPLIT_TOTAL * 10_000_000).toLocaleString("en-US")}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
          <div className="col-span-12 space-y-6 lg:col-span-5">
            <Panel tone="navy" shadow={false}>
              <span className="rounded-full bg-sky px-3 py-1 text-sm font-black text-navy">LISTING</span>
              <p className="mt-3 font-bold text-white/90">
                After the mint closes and every spin has landed, the launch contract seeds PancakeSwap v2 at the mint price — 800,000 TWAK per BNB, the same rate as minting.
                Up to 250 BNB + 200M TWAK. LP tokens are burned to the zero address.
              </p>
            </Panel>
            <Panel tone="candyPale" shadow={false}>
              <h3 className="font-display text-[22px] font-extrabold">What gets burned</h3>
              <ul className="mt-2 space-y-1.5 font-bold text-navy/80">
                <li>★ Unsold mint tokens (80,000 per unsold slot) when the mint closes.</li>
                <li>★ Draw V1 bonus reserve not assigned to any spin (14.8M at a full sellout, more if undersold).</li>
                <li>★ Unused LP allocation if under 250 BNB is listed (e.g. an undersold mint).</li>
                <li>★ Unclaimed Draw V1 bonuses after 180 days.</li>
              </ul>
            </Panel>
          </div>
        </div>

        <VestingPanel />
      </section>
    </>
  );
}
