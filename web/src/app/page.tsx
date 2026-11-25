import Link from "next/link";
import { Icon, type IconName } from "@/components/art";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { TokenomicsChart } from "@/components/TokenomicsChart";
import { Pill } from "@/components/ui";
import { T, type MessageKey } from "@/lib/i18n";
import type { ReactNode } from "react";
import { HomeGenesis, HomeHero } from "./HomeLive";

const PATHS: { href: string; icon: IconName; key: "launch" | "swap" | "draw" | "perps" }[] = [
  { href: "/mint", icon: "launch", key: "launch" },
  { href: "/swap", icon: "swap", key: "swap" },
  { href: "/lottery", icon: "draw", key: "draw" },
  { href: "/perps", icon: "perps", key: "perps" },
];

const k = (s: string) => s as MessageKey;

function SecHead({ n, sys, title, href, link }: { n: string; sys: string; title: ReactNode; href?: string; link?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="sys-label">
          <span className="text-gold">{n}</span> {"//"} {sys}
        </div>
        <h2 className="mt-2 text-[22px] sm:text-[26px]">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="shrink-0 font-mono text-[12.5px] uppercase tracking-[.1em] text-muted transition-colors hover:text-gold">
          {link} →
        </Link>
      ) : null}
    </div>
  );
}

const AGENT_CARDS: { key: "exchange" | "deals" | "judges"; icon: IconName; tone: string }[] = [
  { key: "exchange", icon: "id", tone: "text-gold" },
  { key: "deals", icon: "shield", tone: "text-[#9bf0ff]" },
  { key: "judges", icon: "book", tone: "text-ion" },
];

export default function Home() {
  return (
    <>
      <HomeHero />

      <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
        {/* Agent economy: Exchange, deals, judges */}
        <section id="agents" className="pt-14">
          <SecHead n="01" sys="AGENT://ECONOMY" title={<T k="home.agents.title" />} href="/exchange" link={<T k="home.agents.link" />} />
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {AGENT_CARDS.map((c) => (
              <StaggerItem key={c.key} className="min-w-0">
                <Link href="/exchange" className="lift hud group flex h-full flex-col gap-3 rounded-2xl border border-line bg-card p-6">
                  <div className="flex items-center justify-between">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl border border-line-2 bg-card-2 ${c.tone}`}>
                      <Icon name={c.icon} />
                    </span>
                    <span className="sys-label">
                      <T k={k(`home.agents.${c.key}Tag`)} />
                    </span>
                  </div>
                  <h3 className="mt-2 text-[18px] font-semibold">
                    <T k={k(`home.agents.${c.key}`)} />
                  </h3>
                  <p className="text-[14px] leading-relaxed text-muted">
                    <T k={k(`home.agents.${c.key}Body`)} />
                  </p>
                  <span className="mt-auto pt-1 font-mono text-[12.5px] uppercase tracking-[.1em] text-sub transition-colors group-hover:text-gold">
                    <T k={k(`home.agents.${c.key}Go`)} /> →
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section className="pt-14">
          <SecHead n="02" sys="TWAK://GENESIS" title={<T k="home.launch.title" />} href="/mint" link={<T k="home.launch.link" />} />
          <HomeGenesis />
        </section>

        {/* Tokenomics */}
        <section id="tokenomics" className="pt-14">
          <SecHead n="03" sys="TWAK://SUPPLY" title={<T k="home.tok.title" />} href="/tokenomics" link={<T k="home.tok.link" />} />
          <Reveal className="rounded-2xl border border-line bg-card p-5 sm:p-7">
            <div className="mb-6 flex flex-wrap gap-2">
              <Pill>
                <T k="home.tok.decimals" />
              </Pill>
              <Pill>
                <T k="home.tok.noTax" />
              </Pill>
              <Pill tone="gold">
                <T k="home.tok.burned" />
              </Pill>
            </div>
            <TokenomicsChart />
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card-2 px-4 py-3 text-[14px] text-sub">
              <Pill tone="up">
                <T k="home.tok.listing" />
              </Pill>
              <T k="home.tok.listingBody" />
            </div>
          </Reveal>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="pt-14">
          <SecHead n="04" sys="SYS://ROADMAP" title={<T k="home.road.title" />} />
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StaggerItem className="lift min-w-0 rounded-2xl border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">
                  <T k="home.road.p1" />
                </span>
                <Pill tone="up">
                  <T k="home.road.p1Pill" />
                </Pill>
              </div>
              <ul className="mt-4 space-y-2 text-[14px] text-sub">
                {["a", "b", "c", "d", "e"].map((x) => (
                  <li key={x}>
                    <T k={k(`home.road.p1${x}`)} />
                  </li>
                ))}
              </ul>
            </StaggerItem>
            <StaggerItem className="lift min-w-0 rounded-2xl border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">
                  <T k="home.road.p2" />
                </span>
                <Pill tone="up">
                  <T k="home.road.live" />
                </Pill>
              </div>
              <div className="mt-4 text-[16px] font-semibold">
                <T k="home.road.p2Title" />
              </div>
              <p className="mt-2 text-[14px] text-muted">
                <T k="home.road.p2Body" />
              </p>
              <Link href="/perps" className="mt-3 inline-block text-[14px] font-semibold text-sub transition-colors hover:text-gold">
                <T k="home.road.p2Link" />
              </Link>
            </StaggerItem>
            <StaggerItem className="lift min-w-0 rounded-2xl border border-line bg-card p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-muted">
                  <T k="home.road.p3" />
                </span>
                <Pill tone="gold">
                  <T k="home.road.next" />
                </Pill>
              </div>
              <div className="mt-4 text-[16px] font-semibold">
                <T k="home.road.p3Title" />
              </div>
              <p className="mt-2 text-[14px] text-muted">
                <T k="home.road.p3Body" />
              </p>
            </StaggerItem>
          </Stagger>
        </section>

        {/* Paths */}
        <section className="pb-4 pt-14">
          <SecHead n="05" sys="NAV://NEXT" title={<T k="home.next" />} />
          <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
            {PATHS.map((p) => (
              <StaggerItem key={p.href} className="min-w-0">
                <Link href={p.href} className="lift group flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-card p-[22px]">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-card-2 text-gold">
                    <Icon name={p.icon} />
                  </span>
                  <h3 className="mt-1.5 text-[17px] font-semibold">
                    <T k={k(`home.path.${p.key}`)} />
                  </h3>
                  <p className="text-[14px] text-muted">
                    <T k={k(`home.path.${p.key}Body`)} />
                  </p>
                  <span className="mt-auto pt-1.5 text-[14px] font-semibold text-sub transition-colors group-hover:text-gold">
                    <T k={k(`home.path.${p.key}Go`)} /> →
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      </div>
    </>
  );
}
