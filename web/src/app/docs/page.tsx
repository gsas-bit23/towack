import type { Metadata } from "next";
import Link from "next/link";
import { RISK_NOTE } from "@/components/RiskNote";
import { PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Docs & FAQ" };

const HOWTO = [
  {
    n: 1,
    title: "Get an Agent ID",
    body: "Agent IDs are soulbound handles issued via SPACE ID / the official Binance App on BNB Smart Chain. Towack does not issue them.",
  },
  {
    n: 2,
    title: "Connect your wallet",
    body: "Use a browser wallet, the Binance Wallet, or WalletConnect. Connect the same address that holds your Agent ID. We never ask for keys, seed phrases, or pairing codes.",
  },
  { n: 3, title: "Mint + spin", body: "On Mint, the paid launch mint costs 0.1 BNB plus a small Chainlink VRF fee. You confirm in your wallet and get 80,000 TWAK in the same transaction, and the prize wheel starts spinning while Chainlink VRF answers. One paid mint per Agent ID wallet. Genesis 300 is a separate free mint: 0 BNB goes to Towack. The tiny BNB attached is only a Chainlink VRF randomness buffer, and most of it (every unused wei) is refunded automatically in the same transaction. Pool-wheel spins also attach a VRF buffer the same way." },
  {
    n: 4,
    title: "Claim",
    body: "When the VRF answer lands, the wheel stops on your prize. If you won a refund or bonus, claim it from Mint or Draw. Claims stay open until 180 days after listing.",
  },
  {
    n: 5,
    title: "Trade",
    body: "On Trade, any wallet can swap TWAK ↔ BNB through the Towack router. 1% on the BNB leg; rebates accrue only to Agent ID wallets. Sells use an exact approval for the amount you sell.",
  },
  { n: 6, title: "Rebates", body: "Trading pays fees; finished weeks pay back a pro-rata share of a TWAK budget plus half the BNB fees. Claim on Rebates." },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is Towack an investment?",
    a: "No. Towack is a game of chance. No returns are promised, and there is no passive income. You can lose the BNB you pay to mint, and most slots get back less than they paid.",
  },
  {
    q: "Can I lose my mint BNB?",
    a: "Yes. Each spin wins exactly one outcome from a 5,000-slot deck: 3,500 slots refund 100%, 75%, 50%, or 25% of the 0.095 BNB residual (0.095 / 0.07125 / 0.0475 / 0.02375 BNB; the other 0.005 of each 0.1 is the referral share), 1,020 slots pay a TWAK bonus instead (no BNB back), and 480 slots win nothing. Your 80,000 TWAK is yours either way, but its market price can fall.",
  },
  {
    q: "What are the trading risks?",
    a: "TWAK trades on PancakeSwap v2 and its price can move fast in either direction. Thin liquidity, slippage, and smart-contract risk all apply. Only trade what you can afford to lose.",
  },
  {
    q: "Why do I need an Agent ID?",
    a: "Minting (paid mint and Genesis) is limited to Agent ID holders, checked on-chain against the Agent ID registry. Trader rebates also go only to Agent ID wallets. Anyone can trade TWAK and play Draw V2 without one; their trades pay the same 1% but earn no rebate.",
  },
  {
    q: "Is the Genesis 300 mint free?",
    a: "Yes. The mint itself is free: 0 BNB goes to Towack. Your wallet will ask you to attach a tiny amount of BNB as a Chainlink VRF randomness buffer so the prize wheel can land fairly. Most of that buffer (every unused wei) is refunded automatically in the same transaction. You still pay ordinary network gas.",
  },
  {
    q: "How is the draw kept fair?",
    a: "Every spin uses its own Chainlink VRF random number, so no one (including the Towack team) can pick or predict the result. Paid mint and Genesis draw from fixed decks with exact slot counts; the Draw V2 pool wheel uses a fixed 10,000-slot table with a 95% expected return. Each spin attaches a small BNB randomness buffer; most of it (every unused wei) is refunded automatically in the same transaction.",
  },
  {
    q: "Are rebates staking?",
    a: "No. Rebates only go to wallets that paid router fees in a given week, pro-rata to those fees. Holding TWAK earns nothing.",
  },
  {
    q: "Does this site ever sign for me?",
    a: "No. Every Towack transaction (mint, spin, trade, claims) opens in your own wallet and waits for your confirmation. We never ask for your seed phrase. The one exception is Aster perps, and only if you set it up: a trade-only Aster API wallet is kept in this browser and signs your Aster orders without a popup each time. It cannot withdraw funds, and you can forget it on Perps or revoke it on Aster at any time. Swaps always execute from your own wallet.",
  },
  {
    q: "Is Aster live?",
    a: "Yes, at /perps. Any wallet can trade after setting up a trade-only Aster API wallet, which is kept in your browser, never on a Towack server, and cannot withdraw. An Agent ID is only needed for the \"Give this to your AI agent\" instruction box. Towack adds no fee to Aster trades.",
  },
  {
    q: "Who is behind this? Is it official?",
    a: (
      <>
        Towack is an independent project. It is not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink, or Aster. Official updates are posted on{" "}
        <a href="https://x.com/towackxyz" target="_blank" rel="noopener noreferrer" className="underline decoration-2 underline-offset-2 hover:text-gold">
          @towackxyz
        </a>
        .
      </>
    ),
  },
  {
    q: "Is the code open source?",
    a: "Yes. The contracts and this site are open source. Always verify the published contract addresses before signing.",
  },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader kicker="Docs · FAQ · Risk" title="Read before you play.">
        How Towack works, what can go wrong, and what we will never do.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <div className="rounded-2xl border border-line bg-gold/10 p-8 text-fg">
          <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-fg">PLAIN-LANGUAGE RISK NOTE</span>
          <p className="mt-4 text-[19px] font-medium leading-relaxed">{RISK_NOTE}</p>
        </div>

        <div>
          <h2 className="font-display text-[40px] font-semibold">How to play</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {HOWTO.map((s) => (
              <Panel key={s.n} shadow={false}>
                <div className="grid h-14 w-14 rotate-[-4deg] place-items-center rounded-2xl border border-line bg-gold/15 font-display text-[26px] font-semibold">
                  {s.n}
                </div>
                <h3 className="mt-4 font-display text-[22px] font-semibold">{s.title}</h3>
                <p className="mt-2 font-semibold text-sub">{s.body}</p>
              </Panel>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-display text-[40px] font-semibold">FAQ</h2>
          <div className="mt-6 space-y-4">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-line bg-card p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[20px] font-semibold">
                  {f.q}
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-card-2 transition group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 font-semibold text-sub">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        <Panel tone="raised" shadow={false}>
          <h2 className="font-display text-[24px] font-semibold">Safety promises</h2>
          <ul className="mt-3 grid gap-2 font-medium text-sub md:grid-cols-2">
            <li className="flex gap-2.5"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />We never ask for your wallet&apos;s private key, seed phrase, or pairing codes.</li>
            <li className="flex gap-2.5"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />Every Towack contract transaction opens in your wallet and waits for your confirmation.</li>
            <li className="flex gap-2.5"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />Token approvals are exact amounts, never unlimited.</li>
            <li className="flex gap-2.5"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />Perps only: a trade-only Aster API wallet you set up is stored in this browser and signs Aster orders without a popup. It cannot withdraw, and you can forget it any time.</li>
            <li className="flex gap-2.5"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />No Towack server holds keys or funds. The site reads public chain data and calls public APIs (Aster, swap quotes) from your browser.</li>
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-sub">
            <span>Ready?</span>
            <Link href="/mint" className="inline-flex min-h-10 items-center underline decoration-2 underline-offset-2 hover:text-gold">
              Go to Mint
            </Link>
            <span>or</span>
            <Link href="/draw" className="inline-flex min-h-10 items-center underline decoration-2 underline-offset-2 hover:text-gold">
              see the draw
            </Link>
            <span className="-ml-2">.</span>
          </p>
        </Panel>
      </section>
    </>
  );
}
