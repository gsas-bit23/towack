import type { Metadata } from "next";
import Link from "next/link";
import { RISK_NOTE } from "@/components/RiskNote";
import { PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Docs & FAQ" };

const HOWTO = [
  {
    n: 1,
    title: "Get an Agent ID",
    body: "Agent IDs are issued in the official Binance App on BNB Chain mainnet. Towack does not issue them. Testnet builds use a test registry.",
  },
  {
    n: 2,
    title: "Connect your wallet",
    body: "Use a browser wallet, the Binance Wallet, or WalletConnect. Connect the same address that holds your Agent ID. We never ask for keys, seed phrases, or pairing codes.",
  },
  { n: 3, title: "Mint + spin", body: "On Mint, send 0.1 BNB plus the Chainlink VRF fee shown on the button (a fraction of a cent to a few cents; anything extra is refunded in the same transaction). Genesis 300 has no mint price but also sends the VRF fee, and so does every pool-wheel spin. You confirm in your wallet and get 80,000 TWAK in the same transaction, and the prize wheel starts spinning while Chainlink VRF answers. One mint per Agent ID wallet." },
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
    q: "How is the draw kept fair?",
    a: "Every mint requests its own Chainlink VRF v2.5 random word. The contract uses it only as an index into the remaining fixed deck (word mod slots left) and removes that slot, so the deck counts are exact and nobody can change the word or who it belongs to. The launch contract has no owner. Each request is paid in BNB by the user who makes it, through Chainlink's official VRF v2.5 direct-funding wrapper (no subscription): the contract quotes the fee on-chain (vrfFeeAt), sends the wrapper exactly Chainlink's price for that request and refunds the rest in the same transaction. On BSC testnet, the currently deployed Genesis 300 and pool wheel still use the official Chainlink VRF v2.5 coordinator with a subscription, and the testnet paid-mint contract still uses a team-answered test coordinator, until the full testnet redeploy moves all three to the wrapper.",
  },
  {
    q: "Are rebates staking?",
    a: "No. Rebates only go to wallets that paid router fees in a given week, pro-rata to those fees. Holding TWAK earns nothing.",
  },
  {
    q: "Does this site ever sign for me?",
    a: "Never. Every transaction opens in your own wallet and waits for you to confirm it. There is no server wallet, no auto-sign, and no gasless relayer. Binance's official Auto Sign feature stays inside the official Binance App; this site will never bypass your wallet's confirmation.",
  },
  {
    q: "Is Aster live?",
    a: "No. Aster trading for Agent ID holders is Phase 2: planned, using a user-custodied signer. The project will never hold your keys.",
  },
  {
    q: "Who is behind this? Is it official?",
    a: "Towack is an independent project. It is not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink, or Aster.",
  },
  {
    q: "Is the code open source?",
    a: "Yes. The contracts and this site are open source. This is a testnet / work-in-progress build and details may change before any mainnet launch.",
  },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader kicker="Docs · FAQ · Risk" title="Read before you play.">
        How Towack works, what can go wrong, and what we will never do.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] space-y-10 px-6 pb-16 pt-6">
        <div className="rounded-[36px] border-4 border-navy bg-candy p-8 text-white shadow-[0_10px_0_#13204A]">
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-navy">PLAIN-LANGUAGE RISK NOTE</span>
          <p className="mt-4 text-[19px] font-bold leading-relaxed">{RISK_NOTE}</p>
        </div>

        <div>
          <h2 className="font-display text-[40px] font-extrabold">How to play</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {HOWTO.map((s) => (
              <Panel key={s.n} shadow={false}>
                <div className="grid h-14 w-14 rotate-[-4deg] place-items-center rounded-2xl border-4 border-navy bg-sun font-display text-[26px] font-extrabold shadow-[0_5px_0_#13204A]">
                  {s.n}
                </div>
                <h3 className="mt-4 font-display text-[22px] font-extrabold">{s.title}</h3>
                <p className="mt-2 font-semibold text-navy/75">{s.body}</p>
              </Panel>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-display text-[40px] font-extrabold">FAQ</h2>
          <div className="mt-6 space-y-4">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-[28px] border-4 border-navy bg-white p-6 open:shadow-[0_8px_0_#13204A]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[20px] font-extrabold">
                  {f.q}
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-navy bg-sky transition group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 font-semibold text-navy/80">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        <Panel tone="skyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">Safety promises</h2>
          <ul className="mt-3 grid gap-2 font-bold text-navy/80 md:grid-cols-2">
            <li>★ We never ask for private keys, seed phrases, or pairing codes.</li>
            <li>★ We never sign for you or skip your wallet&apos;s confirmation.</li>
            <li>★ Token approvals are exact amounts, never unlimited.</li>
            <li>★ No server holds keys or funds. The site only reads public chain data.</li>
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-navy/70">
            <span>Ready?</span>
            <Link href="/mint" className="inline-flex min-h-10 items-center underline decoration-2 underline-offset-2 hover:text-candy">
              Go to Mint
            </Link>
            <span>or</span>
            <Link href="/draw" className="inline-flex min-h-10 items-center underline decoration-2 underline-offset-2 hover:text-candy">
              see the draw
            </Link>
            <span className="-ml-2">.</span>
          </p>
        </Panel>
      </section>
    </>
  );
}
