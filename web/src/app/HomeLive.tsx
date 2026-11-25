"use client";

// Live parts of the Atlas home: hero stats + featured Launch card + activity, all from contract reads.
// Nothing here is placeholder data: when a value cannot be read it shows "—".

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { agentDealsV2Abi, drawV2Abi } from "@/abi";
import { AgentMesh } from "@/components/AgentMesh";
import { api, type Stats } from "@/lib/exchange/client";
import { AnimatedNumber, ProgressFill, Skeleton, Stagger, StaggerItem, StageIn } from "@/components/motion";
import { ButtonLink, Pill } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { LAUNCH_PHASES, useLaunchState, useRecentSpins } from "@/lib/draw";
import { shortAddr } from "@/lib/format";
import { DECK_SIZE, PRIZES } from "@/lib/prizes";
import { useNow } from "@/lib/useNow";
import { useLocale, type MessageKey, type TFn } from "@/lib/i18n";
import { prizeAmount, prizeLabel } from "@/lib/prizeText";

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

/** Live Exchange + deals counters for the hero (API stats + AgentDealsV2.dealCount). */
function useAgentEconomy() {
  const { chainId, addresses } = useTowack();
  const { data: stats } = useQuery({ queryKey: ["ex-stats"], queryFn: () => api<Stats>("/stats"), refetchInterval: 30_000, retry: 1 });
  const { data: deals } = useReadContract({
    address: addresses.agentDealsV2,
    abi: agentDealsV2Abi,
    functionName: "dealCount",
    chainId,
    query: { enabled: Boolean(addresses.agentDealsV2), refetchInterval: 30_000 },
  });
  return { agents: stats?.agents, deals: deals === undefined ? undefined : Number(deals) };
}

const DEAL_STEPS = ["offer", "escrow", "deliver", "jury", "settle"] as const;

export function HomeHero() {
  const { meta } = useTowack();
  const { t } = useLocale();
  const s = useLaunchState();
  const eco = useAgentEconomy();
  const minted = s.mintCount === undefined ? undefined : Number(s.mintCount);
  const cap = Number(s.cap);
  const loading = Boolean(s.launch) && minted === undefined;

  const stats: { key: string; label: string; value: ReactNode; sub: string; accent?: boolean }[] = [
    { key: "agents", label: t("hero.stat.agents"), value: eco.agents === undefined ? "—" : <AnimatedNumber value={eco.agents} />, sub: t("hero.stat.agentsSub") },
    { key: "deals", label: t("hero.stat.deals"), value: eco.deals === undefined ? "—" : <AnimatedNumber value={eco.deals} />, sub: t("hero.stat.dealsSub") },
    {
      key: "minted",
      label: t("home.stat.minted"),
      value: loading ? (
        <Skeleton className="h-7 w-24" label={t("home.stat.loadingMinted")} />
      ) : (
        <>
          <AnimatedNumber value={minted} />
          <span className="text-[14px] text-muted md:text-[15px]"> / {cap.toLocaleString("en-US")}</span>
        </>
      ),
      sub: t("home.stat.mintedSub"),
    },
    { key: "judge", label: t("hero.stat.judge"), value: "0.5%", sub: t("hero.stat.judgeSub"), accent: true },
  ];

  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="hero-glow pointer-events-none absolute -right-[220px] -top-[220px] h-[820px] w-[820px] rounded-full" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1240px] px-4 pb-10 pt-9 sm:px-8 md:pb-14 md:pt-16">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-6">
          <StageIn>
            <span className="sys-label inline-flex items-center gap-2">
              <span className="live-dot" aria-hidden="true" />
              {t("hero.kicker", { chain: meta.name })}
            </span>
            <h1 className="mt-5 text-[34px] leading-[1.06] sm:text-[44px] md:text-[54px]">
              {t("hero.titleA")} <span className="signal-text">{t("hero.titleB")}</span> {t("hero.titleC")}
            </h1>
            <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-sub md:text-[17.5px]">{t("hero.lead")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/exchange" size="lg" className="max-sm:flex-1">
                {t("hero.ctaExchange")} <span aria-hidden="true">→</span>
              </ButtonLink>
              <ButtonLink href="/mint" tone="line" size="lg" className="max-sm:flex-1">
                {t("hero.ctaMint")}
              </ButtonLink>
            </div>
            <ol className="hud mt-8 max-w-[560px] rounded-2xl border border-line bg-card px-4 py-3.5 font-mono text-[12.5px] sm:px-5" aria-label={t("hero.console.aria")}>
              <li className="mb-2 flex items-center justify-between text-[10.5px] uppercase tracking-[.16em] text-dim">
                <span>{t("hero.console.title")}</span>
                <span className="text-gold/80">AgentDealsV2</span>
              </li>
              {DEAL_STEPS.map((k, i) => (
                <li key={k} className="grid grid-cols-[24px_68px_minmax(0,1fr)] items-baseline gap-2 py-[3px] sm:grid-cols-[26px_84px_minmax(0,1fr)]">
                  <span className="text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <span className={i === 3 ? "text-ion" : "text-gold"}>{t(`hero.step.${k}` as MessageKey)}</span>
                  <span className="text-sub sm:truncate">{t(`hero.step.${k}Body` as MessageKey)}</span>
                </li>
              ))}
            </ol>
          </StageIn>
          <div className="relative mx-auto w-full max-w-[560px]">
            <AgentMesh className="h-auto w-full" />
          </div>
        </div>

        <Stagger className="relative mt-10 grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-card md:mt-12 md:grid-cols-4">
          {stats.map((st, i) => (
            <StaggerItem key={st.key} className={`min-w-0 px-4 py-4 md:px-[22px] md:py-5 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <small className="block font-mono text-[11px] font-medium uppercase tracking-[.14em] text-muted">{st.label}</small>
              <b className={`mt-2 block whitespace-nowrap font-mono text-[22px] font-medium leading-tight tracking-tight md:text-[28px] ${st.accent ? "text-gold" : ""}`}>{st.value}</b>
              <em className="text-[12.5px] not-italic text-dim">{st.sub}</em>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function FeaturedLaunch() {
  const s = useLaunchState();
  const { t } = useLocale();
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
            <span className="text-[12px] font-semibold uppercase tracking-[.12em] text-gold">{t("home.feat.kicker")}</span>
            <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">{t("home.feat.title")}</h3>
          </div>
          {phase ? <Pill tone={phase === "Minting" ? "up" : "neutral"}>{t(`home.phase.${phase}` as MessageKey)}</Pill> : !s.launch ? <Pill tone="line">{t("home.feat.unavailable")}</Pill> : null}
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-card-2 sm:grid-cols-3 sm:gap-3 sm:bg-transparent">
          {[
            [t("home.feat.price"), "0.1 BNB"],
            [t("home.feat.drop"), "80,000 TWAK"],
            [t("home.feat.bonus"), "1,020"],
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
            <span>{t("home.feat.minted")}</span>
            <span className="font-mono">
              {loading ? (
                <Skeleton className="inline-block h-4 w-20 align-middle" label={t("common.loading")} />
              ) : (
                <>
                  <b className="font-medium text-fg">{minted === undefined ? "—" : minted.toLocaleString("en-US")}</b> / {cap.toLocaleString("en-US")}
                </>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={minted ?? 0} aria-label={t("home.feat.minted")}>
            <ProgressFill pct={pct} className="rounded-full bg-gold" />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[13px] text-muted">
            <span className="font-mono">{minted === undefined ? "—" : t("home.feat.remaining", { n: (cap - minted).toLocaleString("en-US") })}</span>
            <span>{t("home.feat.oneOutcome")}</span>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] text-muted">{t("home.feat.tiers", { n: DECK_SIZE.toLocaleString("en-US") })}</div>
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
          <ButtonLink href="/mint">{t("home.feat.mint")}</ButtonLink>
          <ButtonLink href="/mint" tone="soft">
            {t("home.feat.genesis")}
          </ButtonLink>
          <span className="text-[13px] text-dim">{t("home.feat.reserveNote")}</span>
        </div>
      </article>

      <article className="flex min-w-0 flex-col rounded-2xl border border-line bg-card">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5 sm:px-[22px]">
          <h3 className="text-[16px] font-semibold">{t("home.activity")}</h3>
          <Pill tone={spins.length ? "up" : "line"}>{spins.length ? t("home.activityLive") : t("home.activityFeed")}</Pill>
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
                      <b className="font-semibold">{t("home.mintN", { n: sp.mintIndex.toLocaleString("en-US") })}</b> · {prizeLabel(t, p)}
                    </div>
                    <div className="truncate font-mono text-[12.5px] text-dim">
                      {shortAddr(sp.minter)}
                      {sp.time && now ? ` · ${ago(t, now - sp.time)}` : ""}
                    </div>
                  </div>
                  <div className={`whitespace-nowrap text-right font-mono text-[14px] ${tone}`}>{p.kind === "none" ? "—" : p.kind === "bnb" ? p.amount.replace(" back", "") : prizeAmount(t, p)}</div>
                </StaggerItem>
              );
            })}
          </Stagger>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-2 border-t border-line px-5 py-8 text-center sm:px-[22px]">
            <p className="text-[14px] text-sub">{t("home.noSpins")}</p>
            <p className="text-[13px] text-dim">{t("home.fillsIn")}</p>
          </div>
        )}
        <div className="mt-auto grid grid-cols-2 border-t border-line">
          <div className="px-5 py-4 sm:px-[22px]">
            <small className="text-[12.5px] text-muted">{t("home.pool")}</small>
            <b className="mt-1 block font-mono text-[18px] font-medium tracking-tight">
              {pool.loading ? (
                <Skeleton className="h-6 w-24" label={t("home.loadingPool")} />
              ) : pool.live ? (
                <AnimatedNumber value={pool.poolTwak} compact decimals={2} suffix=" TWAK" />
              ) : (
                <span className="text-dim">—</span>
              )}
            </b>
          </div>
          <div className="border-l border-line px-5 py-4 sm:px-[22px]">
            <small className="text-[12.5px] text-muted">{t("home.poolSpins")}</small>
            <b className="mt-1 block font-mono text-[18px] font-medium tracking-tight">
              {pool.loading ? <Skeleton className="h-6 w-16" label={t("home.loadingSpins")} /> : pool.live ? <AnimatedNumber value={pool.spins} /> : <span className="text-dim">—</span>}
            </b>
          </div>
        </div>
      </article>
    </div>
  );
}

function ago(t: TFn, s: number) {
  const v = Math.max(0, s);
  if (v < 60) return t("home.agoS", { n: v });
  if (v < 3600) return t("home.agoM", { n: Math.floor(v / 60) });
  if (v < 86400) return t("home.agoH", { n: Math.floor(v / 3600) });
  return t("home.agoD", { n: Math.floor(v / 86400) });
}
