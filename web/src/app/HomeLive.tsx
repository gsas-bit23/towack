"use client";

// Live parts of the Atlas home: hero stats + featured Launch card + activity, all from contract reads.
// Nothing here is placeholder data: when a value cannot be read it shows "—".

import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import { drawV2Abi } from "@/abi";
import { InstrumentArc } from "@/components/art";
import { AnimatedNumber, ProgressFill, Skeleton, Stagger, StaggerItem, StageIn } from "@/components/motion";
import { ButtonLink, Pill } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { LAUNCH_PHASES, useLaunchState, useRecentSpins } from "@/lib/draw";
import { shortAddr } from "@/lib/format";
import { DECK_SIZE, PRIZES } from "@/lib/prizes";
import { useNow } from "@/lib/useNow";

const BNB_TIERS = PRIZES.filter((p) => p.kind === "bnb");

function useDrawV2Pool() {
  const { chainId, addresses } = useTowack();
  const c = { address: addresses.drawV2, abi: drawV2Abi, chainId } as const;
  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...c, functionName: "availableTwak" },
      { ...c, functionName: "spinCount" },
    ],
    query: { enabled: Boolean(addresses.drawV2), refetchInterval: 15_000 },
  });
  const twak = data?.[0]?.result as bigint | undefined;
  const spins = data?.[1]?.result as bigint | undefined;
  return {
    live: Boolean(addresses.drawV2),
    loading: Boolean(addresses.drawV2) && isLoading,
    poolTwak: twak === undefined ? undefined : Number(formatUnits(twak, 18)),
    spins: spins === undefined ? undefined : Number(spins),
  };
}

export function HomeHero() {
  const { meta } = useTowack();
  const s = useLaunchState();
  const minted = s.mintCount === undefined ? undefined : Number(s.mintCount);
  const cap = Number(s.cap);
  const progress = minted === undefined ? 0.02 : minted / cap;
  const loading = Boolean(s.launch) && minted === undefined;

  return (
    <section className="relative overflow-hidden border-b border-line">
      {/* soft gold radial + instrument arc (decorative; static under reduced motion) */}
      <div className="hero-glow pointer-events-none absolute -right-[180px] -top-[200px] h-[760px] w-[760px] rounded-full" aria-hidden="true" />
      <InstrumentArc
        progress={progress}
        className="pointer-events-none absolute -right-[170px] -top-[90px] h-[360px] w-[360px] opacity-35 sm:-right-[120px] md:-right-[90px] md:-top-[60px] md:h-[560px] md:w-[560px] md:opacity-80"
      />
      <div className="relative mx-auto max-w-[1200px] px-4 pb-10 pt-9 sm:px-8 md:pb-14 md:pt-[72px]">
        <StageIn>
          <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.12em] text-muted">
            <span className="live-dot" aria-hidden="true" />
            Live on {meta.name}
          </span>
          <h1 className="mt-4 max-w-[760px] text-[38px] font-bold leading-[1.04] tracking-[-0.035em] sm:text-[48px] md:text-[60px]">
            Towack — Agent ID markets <span className="font-medium text-muted">on BNB Chain.</span>
          </h1>
          <p className="mt-4 max-w-[600px] text-[16px] leading-relaxed text-sub md:mt-5 md:text-[18px]">
            Mint a Towack slot with your Agent ID, trade TWAK through the official router with your own on-chain spend limit, and earn rebates as an
            active trader.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 md:mt-8">
            <ButtonLink href="/mint" size="lg" className="max-sm:flex-1">
              Mint a slot · 0.1 BNB
            </ButtonLink>
            <ButtonLink href="/swap" tone="line" size="lg" className="max-sm:flex-1">
              Open Swap
            </ButtonLink>
          </div>
        </StageIn>

        <Stagger className="relative mt-8 grid grid-cols-2 rounded-2xl border border-line bg-surface/80 md:mt-14 md:grid-cols-4">
          <StaggerItem className="min-w-0 px-4 py-4 md:px-[22px] md:py-5">
            <small className="block text-[13px] font-medium text-muted">Slots minted</small>
            <b className="mt-1.5 block whitespace-nowrap font-mono text-[22px] font-medium leading-tight tracking-tight md:text-[28px]">
              {loading ? <Skeleton className="h-7 w-24" label="Loading slots minted" /> : <AnimatedNumber value={minted} />}
              <span className="text-[14px] text-muted md:text-[16px]"> / {cap.toLocaleString("en-US")}</span>
            </b>
            <em className="text-[12.5px] not-italic text-dim">Agent ID holders only</em>
          </StaggerItem>
          <StaggerItem className="min-w-0 border-l border-line px-4 py-4 md:px-[22px] md:py-5">
            <small className="block text-[13px] font-medium text-muted">TWAK supply</small>
            <b className="mt-1.5 block font-mono text-[22px] font-medium leading-tight tracking-tight md:text-[28px]">1B</b>
            <em className="text-[12.5px] not-italic text-dim">Fixed · no transfer tax</em>
          </StaggerItem>
          <StaggerItem className="min-w-0 border-t border-line px-4 py-4 md:border-l md:border-t-0 md:px-[22px] md:py-5">
            <small className="block text-[13px] font-medium text-muted">Router fee</small>
            <b className="mt-1.5 block font-mono text-[22px] font-medium leading-tight tracking-tight md:text-[28px]">1%</b>
            <em className="text-[12.5px] not-italic text-dim">BNB leg only</em>
          </StaggerItem>
          <StaggerItem className="min-w-0 border-l border-t border-line px-4 py-4 md:border-t-0 md:px-[22px] md:py-5">
            <small className="block text-[13px] font-medium text-muted">Draw V2</small>
            <b className="mt-1.5 block font-mono text-[22px] font-medium leading-tight tracking-tight text-gold md:text-[28px]">95%</b>
            <em className="text-[12.5px] not-italic text-dim">Expected return · VRF</em>
          </StaggerItem>
        </Stagger>
      </div>
    </section>
  );
}

export function FeaturedLaunch() {
  const s = useLaunchState();
  const pool = useDrawV2Pool();
  const spins = useRecentSpins(!s.legacy);
  const now = useNow(10_000);
  const minted = s.mintCount === undefined ? undefined : Number(s.mintCount);
  const cap = Number(s.cap);
  const pct = minted === undefined ? 0 : (minted / cap) * 100;
  const loading = Boolean(s.launch) && minted === undefined;
  const phase = s.phase === undefined ? undefined : LAUNCH_PHASES[s.phase];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <article className="gold-hairline lift flex min-w-0 flex-col gap-5 rounded-2xl border border-line bg-card p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[12px] font-semibold uppercase tracking-[.12em] text-gold">Featured · Launch</span>
            <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">Mint one Towack slot per Agent ID</h3>
          </div>
          {phase ? <Pill tone={phase === "Minting" ? "up" : "neutral"}>{phase}</Pill> : !s.launch ? <Pill tone="line">Unavailable</Pill> : null}
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-card-2 sm:grid-cols-3 sm:gap-3 sm:bg-transparent">
          {[
            ["Mint price", "0.1 BNB"],
            ["Instant drop", "80,000 TWAK"],
            ["Bonus slots", "1,020"],
          ].map(([k, v], i) => (
            <div
              key={k}
              className={`flex items-center justify-between px-4 py-3 sm:block sm:rounded-xl sm:bg-card-2 sm:px-4 sm:py-4 ${i ? "border-t border-line sm:border-t-0" : ""}`}
            >
              <small className="text-[12.5px] text-muted">{k}</small>
              <b className="block whitespace-nowrap font-mono text-[18px] font-medium tracking-tight sm:mt-1 sm:text-[21px]">
                {v.endsWith("TWAK") ? (
                  <>
                    {v.replace(" TWAK", "")} <span className="text-gold">TWAK</span>
                  </>
                ) : (
                  v
                )}
              </b>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between gap-3 text-[13px] text-muted">
            <span>Slots minted</span>
            <span className="font-mono">
              {loading ? (
                <Skeleton className="inline-block h-4 w-20 align-middle" label="Loading" />
              ) : (
                <>
                  <b className="font-medium text-fg">{minted === undefined ? "—" : minted.toLocaleString("en-US")}</b> / {cap.toLocaleString("en-US")}
                </>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={minted ?? 0} aria-label="Slots minted">
            <ProgressFill pct={pct} className="rounded-full bg-gold" />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted">
            <span className="font-mono">{minted === undefined ? "—" : `${(cap - minted).toLocaleString("en-US")} remaining`}</span>
            <span>Draw V1 · one VRF outcome per mint</span>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-muted">BNB refund tiers · {DECK_SIZE.toLocaleString("en-US")}-slot deck</div>
          <div className="flex flex-wrap gap-2">
            {BNB_TIERS.map((t, i) => (
              <span
                key={t.id}
                className={`rounded-full border px-3 py-1.5 font-mono text-[13px] ${i === 0 ? "border-gold/45 bg-gold/[.06] text-gold" : "border-line-2 text-sub"}`}
              >
                {t.amount.replace(" BNB back", "")}
              </span>
            ))}
            <span className="rounded-full border border-line-2 px-3 py-1.5 font-mono text-[13px] text-sub">5× = 80k + 320k TWAK</span>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3">
          <ButtonLink href="/mint">Mint a slot</ButtonLink>
          <ButtonLink href="/mint" tone="soft">
            Genesis claim
          </ButtonLink>
          <span className="text-[13px] text-dim">TWAK bonuses are paid from the 50M Draw V1 reserve.</span>
        </div>
      </article>

      <article className="flex min-w-0 flex-col rounded-2xl border border-line bg-card">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-[22px]">
          <h3 className="text-[16px] font-semibold">Activity</h3>
          <Pill tone={spins.length ? "up" : "line"}>{spins.length ? "Live · on-chain" : "Live feed"}</Pill>
        </div>
        {spins.length ? (
          <Stagger as="ul" className="min-w-0">
            {spins.slice(0, 6).map((sp) => {
              const p = PRIZES[sp.prizeId] ?? PRIZES[10];
              const tone = p.kind === "none" ? "text-muted" : p.jackpot ? "text-gold" : "text-up";
              return (
                <StaggerItem as="li" key={sp.key} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-5 py-3 sm:px-[22px]">
                  <span className={`grid h-9 w-9 place-items-center rounded-[10px] bg-card-2 ${tone}`}>
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12" r="2" fill="currentColor" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px]">
                      <b className="font-semibold">Mint #{sp.mintIndex.toLocaleString("en-US")}</b> · {p.label}
                    </div>
                    <div className="truncate font-mono text-[12.5px] text-dim">
                      {shortAddr(sp.minter)}
                      {sp.time && now ? ` · ${ago(now - sp.time)}` : ""}
                    </div>
                  </div>
                  <div className={`whitespace-nowrap text-right font-mono text-[14px] ${tone}`}>{p.kind === "none" ? "—" : p.amount.replace(" back", "")}</div>
                </StaggerItem>
              );
            })}
          </Stagger>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-2 border-t border-line px-5 py-8 text-center sm:px-[22px]">
            <p className="text-[14px] text-sub">No prize-wheel spins in the recent blocks yet.</p>
            <p className="text-[13px] text-dim">Fills in live as mints land.</p>
          </div>
        )}
        <div className="mt-auto grid grid-cols-2 border-t border-line">
          <div className="px-5 py-4 sm:px-[22px]">
            <small className="text-[12.5px] text-muted">Draw V2 pool</small>
            <b className="mt-1 block font-mono text-[18px] font-medium tracking-tight">
              {pool.loading ? (
                <Skeleton className="h-6 w-24" label="Loading pool" />
              ) : pool.live ? (
                <AnimatedNumber value={pool.poolTwak} compact decimals={2} suffix=" TWAK" />
              ) : (
                <span className="text-dim">—</span>
              )}
            </b>
          </div>
          <div className="border-l border-line px-5 py-4 sm:px-[22px]">
            <small className="text-[12.5px] text-muted">Draw V2 spins</small>
            <b className="mt-1 block font-mono text-[18px] font-medium tracking-tight">
              {pool.loading ? <Skeleton className="h-6 w-16" label="Loading spins" /> : pool.live ? <AnimatedNumber value={pool.spins} /> : <span className="text-dim">—</span>}
            </b>
          </div>
        </div>
      </article>
    </div>
  );
}

function ago(s: number) {
  const v = Math.max(0, s);
  if (v < 60) return `${v}s`;
  if (v < 3600) return `${Math.floor(v / 60)}m`;
  if (v < 86400) return `${Math.floor(v / 3600)}h`;
  return `${Math.floor(v / 86400)}d`;
}
