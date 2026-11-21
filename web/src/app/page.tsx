import { AdmitTicket, Arrow, Bulbs, CoinStack, LabelTicket, StarCoin, Sunburst, TwCoin } from "@/components/art";
import { BonusBars, BnbTierStubs } from "@/components/PrizeTables";
import { TokenomicsChart } from "@/components/TokenomicsChart";
import { ButtonLink, Pill } from "@/components/ui";

export default function Home() {
  return (
    <>
      {/* HERO: big rounded stage */}
      <section className="px-6 pb-10 pt-4">
        <div className="relative mx-auto max-w-[1220px]">
          <div className="relative overflow-hidden rounded-[56px] border-[6px] border-navy bg-sky px-6 pb-14 pt-16 shadow-[0_16px_0_#13204A] md:px-10">
            <Bulbs />
            <Sunburst />
            <CoinStack className="bounce absolute bottom-[40px] left-[30px] hidden w-[190px] lg:block" />
            <StarCoin className="bounce bounce-2 absolute left-[190px] top-[70px] hidden w-[90px] lg:block" style={{ ["--r" as string]: "-10deg" }} />
            <AdmitTicket className="bounce bounce-3 absolute right-[40px] top-[90px] hidden w-[230px] lg:block" style={{ ["--r" as string]: "14deg" }} />
            <LabelTicket label="80,000" className="bounce absolute bottom-[50px] right-[70px] hidden w-[170px] lg:block" style={{ ["--r" as string]: "-12deg" }} />

            <div className="relative mx-auto max-w-[780px] text-center">
              <div className="drop inline-flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white">
                <span className="h-2 w-2 rounded-full bg-sun" />
                Agent ID holders only · BSC
              </div>
              <h1 className="drop dl1 mt-7 font-display text-[60px] font-extrabold leading-[.92] text-white lg:text-[96px]" style={{ textShadow: "0 6px 0 #13204A" }}>
                Step right up.
                <br />
                Grab your slot.
              </h1>
              <p className="drop dl2 mx-auto mt-7 max-w-[640px] text-[19px] font-bold leading-snug text-navy lg:text-[21px]">
                0.1 BNB mints one Towack slot per Agent ID — and drops <span className="rounded-lg bg-sun px-2">80,000 TWAK</span> in your wallet on
                the spot. Only 5,000 exist.
              </p>
              <div className="drop dl3 mt-9 flex flex-wrap justify-center gap-4">
                <ButtonLink href="/mint" size="lg">
                  Mint for 0.1 BNB
                </ButtonLink>
                <ButtonLink href="/draw" tone="white" size="lg">
                  See the prize draw
                </ButtonLink>
              </div>
            </div>
          </div>
          <div className="relative mx-auto -mt-2 grid w-[86%] grid-cols-3 overflow-hidden rounded-b-[36px] bg-navy text-white">
            <div className="border-r border-white/10 px-4 py-6 text-center md:px-8">
              <div className="font-display text-[28px] font-extrabold leading-none text-sun md:text-[38px]">5,000</div>
              <div className="mt-1 font-bold text-white/75">Agent ID slots</div>
            </div>
            <div className="border-r border-white/10 px-4 py-6 text-center md:px-8">
              <div className="font-display text-[28px] font-extrabold leading-none text-sky-pale md:text-[38px]">0.1 BNB</div>
              <div className="mt-1 font-bold text-white/75">each, one per holder</div>
            </div>
            <div className="px-4 py-6 text-center md:px-8">
              <div className="font-display text-[28px] font-extrabold leading-none text-candy-pale md:text-[38px]">80K TWAK</div>
              <div className="mt-1 font-bold text-white/75">instantly on mint</div>
            </div>
          </div>
        </div>
      </section>

      {/* DRAW: prize booth */}
      <section id="draw" className="mx-auto max-w-[1220px] px-6 pb-[110px] pt-[90px]">
        <div className="mb-12 grid grid-cols-12 items-end gap-10">
          <div className="col-span-12 lg:col-span-7">
            <div className="font-display text-[15px] font-extrabold uppercase tracking-[.25em] text-candy">The prize booth</div>
            <h2 className="mt-3 font-display text-[48px] font-extrabold leading-[.95] lg:text-[72px]">One spin of the wheel. Every slot at once.</h2>
          </div>
          <p className="col-span-12 text-[18px] font-semibold leading-relaxed text-navy/75 lg:col-span-5">
            After the mint closes, a single <b className="text-navy">Chainlink VRF v2.5</b> seed runs a fair, fixed-slot draw across all minters — not a
            per-person dice roll. When it&apos;s done, you pull your own claim.
          </p>
        </div>

        <div className="rounded-[48px] border-4 border-navy bg-white p-8 shadow-[0_12px_0_#13204A]">
          <div className="mb-6 flex items-center justify-between">
            <div className="font-display text-[28px] font-extrabold">BNB prize tickets at sellout</div>
            <div className="checker h-6 w-[120px] rounded-md opacity-90" aria-hidden="true" />
          </div>
          <BnbTierStubs />
        </div>

        <div className="mt-8 grid grid-cols-12 gap-8">
          <div className="col-span-12 rounded-[40px] bg-candy-pale p-8 lg:col-span-8">
            <div className="font-display text-[28px] font-extrabold">Bonus round: extra TWAK</div>
            <p className="mt-1 font-semibold text-navy/70">
              From the Draw V1 bonus reserve — drawn separately. You can win a BNB refund, a token bonus, both, or neither.
            </p>
            <BonusBars />
          </div>
          <div className="col-span-12 flex flex-col rounded-[40px] bg-navy p-8 text-white lg:col-span-4">
            <svg className="w-[70px]" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="#FFCD2E" stroke="#fff" strokeWidth="5" />
              <text x="50" y="62" textAnchor="middle" fontFamily="var(--font-sora)" fontWeight="800" fontSize="34" fill="#13204A">
                ?
              </text>
            </svg>
            <div className="mt-5 font-display text-[64px] font-extrabold leading-none text-sun">175 BNB</div>
            <div className="mt-1 font-bold text-white/80">total BNB prizes at 5,000 sellout</div>
            <p className="mt-auto pt-5 text-[15px] font-semibold text-white/80">
              That&apos;s a refund-style prize table, not a profit promise. The draw is a game of chance, and most slots get back less than they paid.
            </p>
          </div>
        </div>
        <div className="mt-10 flex justify-center">
          <ButtonLink href="/draw" tone="sun">
            Check the draw machine →
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
          <div className="mt-12 rounded-[44px] border-4 border-navy bg-white p-8 pb-6">
            <TokenomicsChart />
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-4 rounded-[32px] bg-navy px-8 py-5 text-[17px] font-bold text-white md:rounded-full">
            <span className="rounded-full bg-sky px-3 py-1 text-sm font-black text-navy">LISTING</span>
            Planned on PancakeSwap v2 at the mint price, after the draw is assigned. LP tokens are burned.
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
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            <FeeCard pct="50%" color="text-candy" bubble="bg-candy-pale" icon="⚡" title="Active-trader rebate boosts">
              Earned from your trading activity and claimed on-chain. Not sit-and-earn staking.
            </FeeCard>
            <FeeCard pct="30%" color="text-sky-deep" bubble="bg-sky-pale" icon="🎟" title="Lottery / Draw V2 treasury">
              Stocks the prize pool for future ticket rounds.
            </FeeCard>
            <FeeCard pct="20%" color="text-sun-deep" bubble="bg-sun-pale" icon="🛠" title="Dev">
              Keeps the contracts, router, and site moving.
            </FeeCard>
          </div>
          <div className="mt-10 flex justify-center gap-4">
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
          <div className="relative mt-14 grid gap-8 lg:grid-cols-3">
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
                  <li>★ Draw V1 (Chainlink VRF)</li>
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
          </div>
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
