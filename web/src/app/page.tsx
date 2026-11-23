import Link from "next/link";
import { Arrow, Icon, type IconName } from "@/components/art";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { BonusBars, BnbTierStubs } from "@/components/PrizeTables";
import { TokenomicsChart } from "@/components/TokenomicsChart";
import { ButtonLink, Pill } from "@/components/ui";
import { FeaturedLaunch, HomeHero } from "./HomeLive";

const PATHS: { href: string; icon: IconName; title: string; body: string; go: string }[] = [
  { href: "/mint", icon: "launch", title: "Launch", body: "0.1 BNB per Agent ID. 80,000 TWAK instantly, plus one Chainlink VRF prize draw.", go: "Mint a slot" },
  { href: "/swap", icon: "swap", title: "Swap", body: "Best-route quotes across PancakeSwap, Uniswap and Relay, plus bridging out of BNB Chain.", go: "Open Swap" },
  { href: "/lottery", icon: "draw", title: "Draw V2", body: "Instant pool wheel. Enter TWAK, VRF multiplier 0×–10×, 95% expected return.", go: "Open Draw V2" },
  { href: "/perps", icon: "perps", title: "Perps", body: "Live Aster perpetual markets. Trade with an API wallet your own wallet approves.", go: "Open Perps" },
];

const FEES = [
  { pct: "50%", color: "bg-gold", text: "text-gold", title: "Active-trader rebate boosts", body: "Earned from your trading activity and claimed on-chain. Not sit-and-earn staking." },
  { pct: "30%", color: "bg-up", text: "text-up", title: "Lottery / Draw V2 treasury", body: "Stocks the BNB pot. 5× and 10× pool-wheel wins take a capped 1–2% bonus from it." },
  { pct: "20%", color: "bg-[#4A525E]", text: "text-sub", title: "Dev", body: "Keeps the contracts, router, and site moving." },
];

function SecHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>
      {href ? (
        <Link href={href} className="text-[14px] font-medium text-muted transition-colors hover:text-fg">
          {link} →
        </Link>
      ) : null}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <HomeHero />

      <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
        <section className="pt-10">
          <FeaturedLaunch />
        </section>

        {/* Draw V1 prize deck */}
        <section id="draw" className="pt-14">
          <SecHead title="Every mint spins the wheel" href="/draw" link="Prize booth" />
          <Reveal className="rounded-2xl border border-line bg-card p-5 sm:p-7">
            <p className="max-w-[820px] text-[15px] leading-relaxed text-sub">
              Each mint requests its own <b className="font-semibold text-fg">Chainlink VRF v2.5</b> random word. The contract pops one slot from a fixed
              5,000-slot deck and the wheel stops on it — a BNB refund, a TWAK bonus, or better luck next time.{" "}
              <b className="font-semibold text-fg">One outcome per spin</b>, and the odds shift as the deck empties.
            </p>
            <div className="mt-6">
              <BnbTierStubs />
            </div>
          </Reveal>
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Reveal className="min-w-0 rounded-2xl border border-line bg-card p-5 sm:p-7">
              <h3 className="text-[18px] font-semibold">Bonus slots: extra TWAK</h3>
              <p className="mt-1 text-[14px] text-muted">
                Paid from the 50M Draw V1 bonus reserve. A bonus slot replaces a refund — the wheel has one needle, so each mint wins exactly one
                outcome. A 5× slot means 80,000 + 320,000 TWAK.
              </p>
              <BonusBars />
            </Reveal>
            <Reveal className="gold-hairline flex min-w-0 flex-col rounded-2xl border border-line bg-card p-5 sm:p-7" delay={0.08}>
              <span className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">Whole prize deck</span>
              <div className="mt-3 font-mono text-[36px] font-medium leading-none tracking-tight text-gold sm:text-[44px]">166.25 BNB</div>
              <div className="mt-2 text-[14px] text-sub">+ 35.2M TWAK in bonuses: the whole prize pool at a 5,000 sellout</div>
              <p className="mt-auto pt-5 text-[13.5px] text-muted">
                That&apos;s a refund-style prize deck, not a profit promise. The draw is a game of chance, and most spins get back less than they paid.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Router */}
        <section id="router" className="pt-14">
          <SecHead title="Open router · Agent ID rebates" href="/trade" link="Open the router" />
          <Reveal className="grid grid-cols-1 overflow-hidden rounded-2xl border border-line bg-card lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0 border-b border-line p-5 sm:p-7 lg:border-b-0 lg:border-r">
              <p className="text-[15px] leading-relaxed text-sub">
                Any wallet can trade through the official Towack router. It charges <b className="font-semibold text-fg">1% on the BNB leg</b> of a trade —
                not a transfer tax on the token. Rebates accrue only to Agent ID wallets. You set your own on-chain daily spend limit.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {[
                  ["You + Agent ID", "daily limit set"],
                  ["Towack router", "1% · BNB leg"],
                  ["PancakeSwap v2", "swap executes"],
                ].map(([t, s], i) => (
                  <div key={t} className="flex items-center gap-3">
                    {i ? <Arrow /> : null}
                    <div className={`rounded-xl border px-4 py-3 ${i === 1 ? "border-gold/40 bg-gold/[.06]" : "border-line-2 bg-card-2"}`}>
                      <div className="text-[14px] font-semibold">{t}</div>
                      <div className="font-mono text-[12.5px] text-muted">{s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 p-5 sm:p-7">
              <div className="text-[13px] text-muted">Where the 1% router fee goes</div>
              <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                {FEES.map((f) => (
                  <i key={f.pct + f.title} className={f.color} style={{ flex: parseInt(f.pct, 10) }} />
                ))}
              </div>
              <ul className="mt-4 space-y-3">
                {FEES.map((f) => (
                  <li key={f.title} className="flex gap-3">
                    <span className={`w-11 shrink-0 font-mono text-[15px] font-medium ${f.text}`}>{f.pct}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">{f.title}</span>
                      <span className="block text-[13px] text-muted">{f.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <ButtonLink href="/trade" tone="line" size="sm">
                  Open the router
                </ButtonLink>
                <ButtonLink href="/rebates" tone="soft" size="sm">
                  Rebates
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Tokenomics */}
        <section id="tokenomics" className="pt-14">
          <SecHead title="1B TWAK, fixed supply" href="/tokenomics" link="Tokenomics" />
          <Reveal className="rounded-2xl border border-line bg-card p-5 sm:p-7">
            <div className="mb-6 flex flex-wrap gap-2">
              <Pill>18 decimals</Pill>
              <Pill>No transfer tax</Pill>
              <Pill tone="gold">Unsold mint tokens burned</Pill>
            </div>
            <TokenomicsChart />
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card-2 px-4 py-3 text-[14px] text-sub">
              <Pill tone="up">Listing</Pill>
              Planned on PancakeSwap v2 at the mint price, once the mint closes and every spin has landed. LP tokens are burned.
            </div>
          </Reveal>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="pt-14">
          <SecHead title="Roadmap" />
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StaggerItem className="lift min-w-0 rounded-2xl border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">01 · Phase 1</span>
                <Pill tone="up">Core stack</Pill>
              </div>
              <ul className="mt-4 space-y-2 text-[14px] text-sub">
                <li>Agent ID slot mint + 5% referrals</li>
                <li>Genesis 300 free mint + Draw V1 wheel</li>
                <li>Draw V2 instant pool wheel</li>
                <li>Open PancakeSwap v2 router + rebates</li>
                <li>All on BNB Smart Chain</li>
              </ul>
            </StaggerItem>
            <StaggerItem className="lift min-w-0 rounded-2xl border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">02 · Phase 2</span>
                <Pill tone="up">Live</Pill>
              </div>
              <div className="mt-4 text-[16px] font-semibold">Aster perps</div>
              <p className="mt-2 text-[14px] text-muted">
                Live Aster perpetual markets, open to any wallet through a trade-only Aster API wallet you set up and keep in your browser. It cannot withdraw funds. An Agent ID unlocks the &ldquo;Give this to your AI agent&rdquo; box.
              </p>
              <Link href="/perps" className="mt-3 inline-block text-[14px] font-semibold text-sub transition-colors hover:text-gold">
                Open Perps →
              </Link>
            </StaggerItem>
            <StaggerItem className="min-w-0 rounded-2xl border border-dashed border-line-2 p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">03 · Next</span>
                <Pill tone="line">Pending</Pill>
              </div>
              <div className="mt-4 text-[16px] font-semibold">BNB Smart Chain mainnet deploy</div>
              <p className="mt-2 text-[14px] text-muted">Everything above runs on BSC Testnet today. The Towack contracts are not yet deployed on mainnet; that deploy happens only after the final go-ahead.</p>
            </StaggerItem>
          </Stagger>
        </section>

        {/* Paths */}
        <section className="pb-4 pt-14">
          <SecHead title="Where to go next" />
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {PATHS.map((p) => (
              <StaggerItem key={p.href} className="min-w-0">
                <Link href={p.href} className="lift group flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-card p-[22px]">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-card-2 text-gold">
                    <Icon name={p.icon} />
                  </span>
                  <h3 className="mt-1.5 text-[17px] font-semibold">{p.title}</h3>
                  <p className="text-[14px] text-muted">{p.body}</p>
                  <span className="mt-auto pt-1.5 text-[14px] font-semibold text-sub transition-colors group-hover:text-gold">{p.go} →</span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      </div>
    </>
  );
}
