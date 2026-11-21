import { AdmitTicket, Arrow, Bulbs, CoinStack, LabelTicket, StarCoin, Sunburst, TwCoin } from "@/components/art";
import { HomeWheel } from "@/components/HomeWheel";
import { Reveal, StageIn } from "@/components/motion";
import { BonusBars, BnbTierStubs } from "@/components/PrizeTables";
import { TokenomicsChart } from "@/components/TokenomicsChart";
import { ButtonLink, Pill } from "@/components/ui";

const HERO_CTA = "max-sm:px-7 max-sm:py-3.5 max-sm:text-[17px]";

const HERO_STATS = [
  { value: "5,000", label: "Agent ID slots", color: "text-sun" },
  { value: "0.1 BNB", label: "each, one per holder", color: "text-sky-pale" },
  { value: "80K TWAK", label: "instantly on mint", color: "text-candy-pale" },
] as const;

export default function Home() {
  return (
    <>
      {/* HERO: big rounded stage */}
      <section className="px-4 pb-10 pt-4 sm:px-6">
        <StageIn className="relative mx-auto max-w-[1220px]">
          <div className="relative overflow-hidden rounded-[40px] border-[6px] border-navy bg-sky px-4 pb-12 pt-12 shadow-[0_16px_0_#13204A] sm:rounded-[56px] sm:px-6 sm:pb-14 sm:pt-16 md:px-10">
            <div className="stage-glow pointer-events-none absolute inset-0" aria-hidden="true" />
            <Bulbs />
            <Sunburst />
            <CoinStack className="bounce absolute bottom-[40px] left-[30px] hidden w-[150px] xl:block 2xl:w-[190px]" />
            <StarCoin className="bounce bounce-2 absolute left-[190px] top-[70px] hidden w-[80px] xl:block 2xl:w-[90px]" style={{ ["--r" as string]: "-10deg" }} />
            <AdmitTicket className="bounce bounce-3 absolute right-[30px] top-[90px] hidden w-[180px] xl:block 2xl:w-[230px]" style={{ ["--r" as string]: "14deg" }} />
            <LabelTicket label="80,000" className="bounce absolute bottom-[50px] right-[40px] hidden w-[140px] xl:block 2xl:w-[170px]" style={{ ["--r" as string]: "-12deg" }} />

            <div className="relative mx-auto max-w-[780px] text-center xl:max-w-[720px] 2xl:max-w-[780px]">
              <div className="drop inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white">
                <span className="h-2 w-2 rounded-full bg-sun" />
                Agent ID holders only · BSC
              </div>
              <h1 className="drop dl1 mt-6 font-display text-[40px] font-extrabold leading-[.92] text-white min-[400px]:text-[46px] sm:mt-7 sm:text-[56px] md:text-[72px] lg:text-[96px]" style={{ textShadow: "0 6px 0 #13204A" }}>
                Step right up.
                <br />
                Grab your slot.
              </h1>
              <p className="drop dl2 mx-auto mt-6 max-w-[640px] text-[17px] font-bold leading-snug text-navy sm:mt-7 sm:text-[19px] lg:text-[21px]">
                0.1 BNB mints one Towack slot per Agent ID, drops <span className="rounded-lg bg-sun px-2">80,000 TWAK</span> in your wallet on the
                spot, and spins the prize wheel. Only 5,000 exist.
              </p>
              <div className="drop dl3 mt-8 flex flex-wrap justify-center gap-4 sm:mt-9">
                <ButtonLink href="/mint" size="lg" className={HERO_CTA}>
                  Mint for 0.1 BNB
                </ButtonLink>
                <ButtonLink href="/draw" tone="white" size="lg" className={HERO_CTA}>
                  Visit the prize booth
                </ButtonLink>
              </div>
            </div>
          </div>
          <div className="relative mx-auto -mt-2 grid w-[92%] grid-cols-1 overflow-hidden rounded-b-[28px] bg-navy text-white sm:w-[86%] sm:grid-cols-3 sm:rounded-b-[36px]">
            {HERO_STATS.map((st, i) => (
              <div
                key={st.value}
                className={`flex min-w-0 items-baseline justify-between gap-3 px-5 py-3.5 sm:block sm:px-3 sm:py-6 sm:text-center md:px-4 lg:px-8 ${
                  i < HERO_STATS.length - 1 ? "border-b border-white/10 sm:border-b-0 sm:border-r" : ""
                }`}
              >
                <div className={`shrink-0 font-display text-[24px] font-extrabold leading-none md:text-[30px] lg:text-[38px] ${st.color}`}>{st.value}</div>
                <div className="mt-1 text-right font-bold text-white/75 sm:text-center">{st.label}</div>
              </div>
            ))}
          </div>
        </StageIn>
      </section>

      {/* DRAW: prize booth */}
      <section id="draw" className="mx-auto max-w-[1220px] px-6 pb-[110px] pt-[90px]">
        <Reveal className="mb-12 grid grid-cols-12 items-center gap-x-0 gap-y-10 lg:gap-x-10 [&>*]:min-w-0">
          <div className="col-span-12 lg:col-span-7">
            <div className="font-display text-[15px] font-extrabold uppercase tracking-[.25em] text-candy">The prize booth</div>
            <h2 className="mt-3 font-display text-[48px] font-extrabold leading-[.95] lg:text-[72px]">Every mint spins the wheel.</h2>
            <p className="mt-6 text-[18px] font-semibold leading-relaxed text-navy/75">
              Each mint requests its own <b className="text-navy">Chainlink VRF v2.5</b> random word. The contract pops one slot from a fixed
              5,000-slot deck and the wheel stops on it — a BNB refund, a TWAK bonus, or better luck next time. <b className="text-navy">One outcome
              per spin</b>, and the odds shift as the deck empties.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 font-black">
              <span className="rounded-full border-[3px] border-navy bg-sun px-4 py-2">3,500 BNB refunds</span>
              <span className="rounded-full border-[3px] border-navy bg-candy-pale px-4 py-2">1,020 TWAK bonuses</span>
              <span className="rounded-full border-[3px] border-navy bg-white px-4 py-2">480 no prize</span>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <HomeWheel />
          </div>
        </Reveal>

        <Reveal className="rounded-[36px] border-4 border-navy bg-white p-5 shadow-[0_12px_0_#13204A] sm:rounded-[48px] sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="min-w-0 font-display text-[24px] font-extrabold sm:text-[28px]">BNB refund slots in the 5,000-slot deck</div>
            <div className="checker hidden h-6 w-[120px] shrink-0 rounded-md opacity-90 sm:block" aria-hidden="true" />
          </div>
          <BnbTierStubs />
        </Reveal>

        <div className="mt-8 grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
          <Reveal className="col-span-12 rounded-[40px] bg-candy-pale p-6 sm:p-8 lg:col-span-8">
            <div className="font-display text-[28px] font-extrabold">Bonus slots: extra TWAK</div>
            <p className="mt-1 font-semibold text-navy/70">
              Paid from the 50M Draw V1 bonus reserve. A bonus slot replaces a refund — the wheel has one needle, so each mint wins exactly one
              outcome. A 5× slot means 80,000 + 320,000 TWAK.
            </p>
            <BonusBars />
          </Reveal>
          <Reveal className="col-span-12 flex flex-col rounded-[40px] bg-navy p-6 text-white sm:p-8 lg:col-span-4" delay={0.1}>
            <svg className="w-[70px]" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="#FFCD2E" stroke="#fff" strokeWidth="5" />
              <text x="50" y="62" textAnchor="middle" fontFamily="var(--font-sora)" fontWeight="800" fontSize="34" fill="#13204A">
                ?
              </text>
            </svg>
            <div className="mt-5 font-display text-[52px] font-extrabold leading-none text-sun sm:text-[64px]">175 BNB</div>
            <div className="mt-1 font-bold text-white/80">+ 35.2M TWAK in bonuses: the whole prize pool at a 5,000 sellout</div>
            <p className="mt-auto pt-5 text-[15px] font-semibold text-white/80">
              That&apos;s a refund-style prize deck, not a profit promise. The draw is a game of chance, and most spins get back less than they paid.
            </p>
          </Reveal>
        </div>
        <div className="mt-10 flex justify-center">
          <ButtonLink href="/draw" tone="sun">
            Step into the prize booth →
          </ButtonLink>
        </div>
      </section>

      {/* TOKENOMICS: gold band */}
      <section id="tokenomics" className="border-y-[6px] border-navy bg-sun">
        <div className="mx-auto max-w-[1220px] px-6 py-[100px]">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="font-display text-[15px] font-extrabold uppercase tracking-[.25em] text-navy/70">Tokenomics</div>
              <h2 className="mt-3 max-w-[700px] font-display text-[48px] font-extrabold leading-[.95] lg:text-[72px]">1B TWAK in the coin pusher.</h2>
            </div>
            <div className="flex flex-col items-end gap-2 font-black">
              <span className="rounded-full border-[3px] border-navy bg-white px-4 py-2">18 decimals</span>
              <span className="rounded-full border-[3px] border-navy bg-white px-4 py-2">No transfer tax</span>
              <span className="rounded-full bg-navy px-4 py-2 text-white">Unsold mint tokens burned</span>
            </div>
          </div>
          <Reveal className="mt-12 min-w-0 rounded-[36px] border-4 border-navy bg-white p-5 sm:rounded-[44px] sm:p-8 sm:pb-6">
            <TokenomicsChart />
          </Reveal>
          <div className="mt-8 flex flex-wrap items-center gap-4 rounded-[32px] bg-navy px-8 py-5 text-[17px] font-bold text-white md:rounded-full">
            <span className="rounded-full bg-sky px-3 py-1 text-sm font-black text-navy">LISTING</span>
            Planned on PancakeSwap v2 at the mint price, once the mint closes and every spin has landed. LP tokens are burned.
          </div>
        </div>
      </section>

      {/* ROUTER: sky band */}
      <section id="router" className="bg-sky-pale">
        <div className="mx-auto max-w-[1220px] px-6 py-[110px]">
          <div className="mx-auto max-w-[820px] text-center">
            <div className="font-display text-[15px] font-extrabold uppercase tracking-[.25em] text-sky-deep">Agent ID-only router</div>
            <h2 className="mt-3 font-display text-[48px] font-extrabold leading-[.95] lg:text-[72px]">Your swaps, your rules.</h2>
            <p className="mt-5 text-[19px] font-semibold text-navy/75">
              The official Towack router is for Agent ID holders. It charges <b className="text-navy">1% on the BNB leg</b> of a trade — not a transfer
              tax on the token. You set your own on-chain daily spend limit.
            </p>
          </div>
          <div className="mt-14 flex flex-wrap items-center justify-center gap-5">
            <div className="rounded-[32px] border-4 border-navy bg-white px-8 py-6 text-center shadow-[0_8px_0_#13204A]">
              <div className="text-[34px]" aria-hidden="true">🪪</div>
              <div className="mt-1 font-display text-[20px] font-extrabold">You + Agent ID</div>
              <div className="text-sm font-bold text-navy/60">daily limit set</div>
            </div>
            <Arrow />
            <div className="rounded-[32px] border-4 border-navy bg-candy px-8 py-6 text-center text-white shadow-[0_8px_0_#13204A]">
              <div className="font-display text-[40px] font-extrabold leading-none">1%</div>
              <div className="mt-1 font-display text-[20px] font-extrabold">Towack router</div>
              <div className="text-sm font-bold text-white/80">on the BNB leg</div>
            </div>
            <Arrow />
            <div className="rounded-[32px] border-4 border-navy bg-white px-8 py-6 text-center shadow-[0_8px_0_#13204A]">
              <div className="text-[34px]" aria-hidden="true">🥞</div>
              <div className="mt-1 font-display text-[20px] font-extrabold">PancakeSwap v2</div>
              <div className="text-sm font-bold text-navy/60">swap executes</div>
            </div>
          </div>
          <Reveal className="mt-14 grid gap-6 md:grid-cols-3">
            <FeeCard pct="50%" color="text-candy" bubble="bg-candy-pale" icon="⚡" title="Active-trader rebate boosts">
              Earned from your trading activity and claimed on-chain. Not sit-and-earn staking.
            </FeeCard>
            <FeeCard pct="30%" color="text-sky-deep" bubble="bg-sky-pale" icon="🎟" title="Lottery / Draw V2 treasury">
              Stocks the prize pool for future ticket rounds.
            </FeeCard>
            <FeeCard pct="20%" color="text-sun-deep" bubble="bg-sun-pale" icon="🛠" title="Dev">
              Keeps the contracts, router, and site moving.
            </FeeCard>
          </Reveal>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <ButtonLink href="/trade" tone="white">
              Open the router
            </ButtonLink>
            <ButtonLink href="/rebates" tone="sky">
              Rebates
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ROADMAP: candy band */}
      <section id="roadmap" className="relative overflow-hidden border-y-[6px] border-navy bg-candy text-white">
        <TwCoin className="bounce absolute right-[60px] top-[60px] hidden w-[110px] md:block" />
        <div className="mx-auto max-w-[1220px] px-6 py-[110px]">
          <div className="font-display text-[15px] font-extrabold uppercase tracking-[.25em] text-white/80">Roadmap</div>
          <h2 className="mt-3 font-display text-[48px] font-extrabold leading-[.95] lg:text-[72px]" style={{ textShadow: "0 5px 0 #13204A" }}>
            Level select.
          </h2>
          <Reveal className="relative mt-14 grid gap-8 lg:grid-cols-3">
            <svg className="absolute left-[16%] top-[54px] hidden h-[20px] w-[68%] lg:block" viewBox="0 0 800 20" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 10 H800" stroke="#13204A" strokeWidth="8" strokeDasharray="20 14" strokeLinecap="round" />
            </svg>
            <div className="relative text-center">
              <div className="mx-auto grid h-[110px] w-[110px] rotate-[-4deg] place-items-center rounded-[32px] border-4 border-navy bg-sun font-display text-[44px] font-extrabold text-navy shadow-[0_8px_0_#13204A]">1</div>
              <div className="mt-8 min-h-[250px] rounded-[36px] border-4 border-navy bg-white p-7 text-left text-navy">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[24px] font-extrabold">Phase 1</span>
                  <Pill tone="sky">BUILDING · TESTNET</Pill>
                </div>
                <ul className="mt-4 space-y-2 font-bold text-navy/80">
                  <li>★ Agent ID slot mint</li>
                  <li>★ Draw V1 prize wheel (per-mint VRF)</li>
                  <li>★ PancakeSwap v2 router</li>
                  <li>★ Active-trader rebates</li>
                  <li>★ All on BSC</li>
                </ul>
              </div>
            </div>
            <div className="relative text-center">
              <div className="mx-auto grid h-[110px] w-[110px] rotate-[3deg] place-items-center rounded-[32px] border-4 border-navy bg-white font-display text-[44px] font-extrabold text-navy shadow-[0_8px_0_#13204A]">2</div>
              <div className="mt-8 min-h-[250px] rounded-[36px] border-4 border-navy bg-white p-7 text-left text-navy">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[24px] font-extrabold">Phase 2</span>
                  <Pill tone="ice">PLANNED</Pill>
                </div>
                <div className="mt-4 font-display text-[22px] font-extrabold">Aster for Agent ID holders</div>
                <p className="mt-2 font-bold text-navy/75">
                  Planned: trading via a user-custodied signer. The project never holds your keys. Not live.
                </p>
              </div>
            </div>
            <div className="relative text-center">
              <div className="mx-auto grid h-[110px] w-[110px] rotate-[-2deg] place-items-center rounded-[32px] border-4 border-dashed border-white/60 bg-navy font-display text-[44px] font-extrabold text-white">?</div>
              <div className="mt-8 min-h-[250px] rounded-[36px] border-4 border-dashed border-white/60 bg-white/15 p-7 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[24px] font-extrabold">Later</span>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-black">COMING UP</span>
                </div>
                <div className="mt-4 font-display text-[22px] font-extrabold">Draw V2 ticket rounds</div>
                <p className="mt-2 font-bold text-white/85">Recurring rounds stocked by the Draw V2 allocation and router treasury. MVP contract in testing.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

    </>
  );
}

function FeeCard({
  pct,
  color,
  bubble,
  icon,
  title,
  children,
}: {
  pct: string;
  color: string;
  bubble: string;
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="press rounded-[36px] border-4 border-navy bg-white p-8">
      <div className="flex items-center justify-between">
        <span className={`font-display text-[56px] font-extrabold leading-none ${color}`}>{pct}</span>
        <span className={`grid h-14 w-14 place-items-center rounded-full text-2xl ${bubble}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="mt-4 font-display text-[22px] font-extrabold">{title}</div>
      <p className="mt-2 font-semibold text-navy/70">{children}</p>
    </div>
  );
}
