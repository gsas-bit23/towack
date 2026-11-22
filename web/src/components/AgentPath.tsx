"use client";

import { useState } from "react";
import { encodeFunctionData, toFunctionSelector, zeroAddress, type Address } from "viem";
import { ADDRESSES } from "@/config/addresses";
import { useTowack } from "@/lib/chain";
import { buildPerpsInstruction, type PerpsAgentIntent } from "@/lib/aster/instruction";
import { Button, Pill } from "./ui";

/**
 * "Give this to your AI agent": copyable instructions for Binance Agentic Wallet (BAW) users.
 *
 * BAW is MAINNET-ONLY (chain 56) and cannot connect to web pages, so this site never signs, never broadcasts and
 * never runs the BAW CLI: it only displays text the user pastes into their own AI agent (which has Binance's
 * official `binance-agentic-wallet` skill). Addresses come from addresses.json chain 56 only; empty ones are shown
 * as visible placeholders ("pending mainnet deploy"), never invented.
 */

export type AgentFlow =
  | "launch" // TowackLaunch.mint(address referrer)
  | "genesis" // TowackGenesis.mint(uint256)
  | "lottery" // DrawV2 approve + enter
  | "launchClaim"
  | "genesisClaim"
  | "lotteryClaim"
  | "referralClaim" // TowackLaunch.claimReferral()
  | "buy" // TowackRouter.buy
  | "sell" // TWAK.approve(exact) + TowackRouter.sell
  | "perps"; // Aster perps: NOT a contract-call. BAW sign-message approves a trade-only API wallet; it signs orders.

/** Referrer baked into a paid-mint instruction (from `?ref=` / `/r/<handle>`). */
export type AgentReferral = { address?: Address; handle?: string };

const BAW_SKILL_URL = "https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet";
const TOWACK_SKILL_PATH = "/skills/towack/SKILL.md";
const MINT_PRICE_WEI = "100000000000000000"; // 0.1 BNB

const ABI = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ name: "referrer", type: "address" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimReferral", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;
const CLAIM_HEX = encodeFunctionData({ abi: ABI, functionName: "claim" });
const CLAIM_REFERRAL_HEX = encodeFunctionData({ abi: ABI, functionName: "claimReferral" });
const SEL_MINT_REF = toFunctionSelector("mint(address)");
const SEL_GENESIS_MINT = toFunctionSelector("mint(uint256)");
const SEL_APPROVE = toFunctionSelector("approve(address,uint256)");
const SEL_ENTER = toFunctionSelector("enter(uint256)");
const SEL_VRF_FEE_AT = toFunctionSelector("vrfFeeAt(uint256)");
const SEL_BUY = toFunctionSelector("buy(uint256,uint256)");
const SEL_SELL = toFunctionSelector("sell(uint256,uint256,uint256)");
const SEL_GET_AMOUNTS_OUT = toFunctionSelector("getAmountsOut(uint256,address[])");

/** Calldata for TowackLaunch.mint(address referrer); address(0) = no referral. */
export function mintCalldata(referrer?: Address): `0x${string}` {
  return encodeFunctionData({ abi: ABI, functionName: "mint", args: [referrer ?? zeroAddress] });
}

type Key = "launch" | "genesis" | "drawV2" | "token" | "router" | "pancakeRouter" | "wbnb";

function mainnet(key: Key, placeholder: string) {
  const a = ADDRESSES[56][key];
  return { addr: a ?? placeholder, missing: !a };
}

const PENDING = "  (pending mainnet deploy: do NOT send anything until Towack publishes this address)";

const BASE_RULES = `Rules (Binance Agentic Wallet, official external-sign flow):
- BNB Smart Chain MAINNET only: --binanceChainId 56. Towack's website never signs or broadcasts for me; you prepare, I confirm.
- Before any contract-call, run \`baw wallet settings --json\` and confirm devMode.enabled=true. If it is off, tell me to enable Developer Mode in the Binance App and WAIT.
- For every transaction: \`baw contract-call preview --binanceChainId 56 --from <my wallet> --to <contract> --value <wei> --inputData <hex> --json\`.
  Show me the parsed tx, the risks and the authorityChanges, then WAIT for my explicit "yes".
  Only then: \`baw contract-call execute --requestId <requestId> --json\`. Never execute without a fresh preview + my yes.
- --value is raw wei (an integer). Do not pass a gas price.`;

const vrfRule = (contract: string) =>
  `- VRF fee: read ${contract}.vrfFeeAt(gasPrice) (selector ${SEL_VRF_FEE_AT}) with an eth_call at the current BSC gas price. Underpaying reverts; any excess is refunded by the contract in the same tx.`;

const footer = (rules: string) => `${rules}
Towack skill: ${TOWACK_SKILL_PATH} on the Towack site.`;

function missingList(items: [string, boolean][]) {
  return items.filter(([, m]) => m).map(([n]) => n);
}

const DEFAULT_PERPS: PerpsAgentIntent = { kind: "order", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "", base: "BTC" };

export function buildInstruction(flow: AgentFlow, referral?: AgentReferral, perps?: PerpsAgentIntent): { text: string; missing: string[] } {
  const l = mainnet("launch", "<TOWACK_LAUNCH>");
  const g = mainnet("genesis", "<TOWACK_GENESIS>");
  const d = mainnet("drawV2", "<TOWACK_DRAWV2>");
  const t = mainnet("token", "<TOWACK_TWAK>");
  const r = mainnet("router", "<TOWACK_ROUTER>");

  switch (flow) {
    case "perps":
      return { text: buildPerpsInstruction(perps ?? DEFAULT_PERPS), missing: [] };
    case "launch": {
      const ref = referral?.address;
      const who = ref ? `${referral?.handle ? `${referral.handle} (${ref})` : ref}` : undefined;
      const text = `Towack paid mint on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: TowackLaunch ${l.addr}${l.missing ? PENDING : ""}
Requirement: my wallet must hold an Agent ID (one mint per Agent ID wallet).
Referrer: ${who ? `${who}. They earn 0.005 BNB (5% of the mint price) from the contract; my price stays 0.1 BNB.` : "none (address(0))."}

1) Quote fee = TowackLaunch.vrfFeeAt(currentGasPrice).
2) mint(address referrer) (selector ${SEL_MINT_REF}), referrer = ${ref ?? zeroAddress}:
   --inputData ${mintCalldata(ref)}
   --value = ${MINT_PRICE_WEI} + fee  (0.1 BNB + VRF fee, in wei).
   It reverts if the referrer is my own wallet (SelfReferral) or holds no Agent ID (ReferrerHasNoAgentId).
3) After the spin lands (Chainlink VRF), when I ask: claim(): --inputData ${CLAIM_HEX}  --value 0.

${footer(`${BASE_RULES}\n${vrfRule("TowackLaunch")}`)}`;
      return { text, missing: missingList([["TowackLaunch", l.missing]]) };
    }
    case "genesis": {
      const text = `Towack Genesis 300 free mint on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: TowackGenesis ${g.addr}${g.missing ? PENDING : ""}
Requirement: my wallet must own the Agent ID token I name (one Genesis per Agent ID and per wallet). Genesis has no referrals.

1) Quote fee = TowackGenesis.vrfFeeAt(currentGasPrice).
2) mint(uint256 agentTokenId) (selector ${SEL_GENESIS_MINT}): ABI-encode my Agent ID token id as --inputData; --value = fee (no mint price, VRF fee only).
3) After the spin lands, when I ask: claim(): --inputData ${CLAIM_HEX}  --value 0.

${footer(`${BASE_RULES}\n${vrfRule("TowackGenesis")}`)}`;
      return { text, missing: missingList([["TowackGenesis", g.missing]]) };
    }
    case "lottery": {
      const pending = d.missing || t.missing;
      const text = `Towack Draw V2 pool wheel entry on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contracts: TWAK ${t.addr} · DrawV2 ${d.addr}${pending ? "  (pending mainnet deploy: do NOT send anything until Towack publishes these addresses)" : ""}
Anyone can enter (no Agent ID needed). Amount: <AMOUNT_TWAK_WEI> (18 decimals, minimum entry applies).

1) TWAK.approve(DrawV2, amount) (selector ${SEL_APPROVE}): --to TWAK, --value 0. Exact amount only, never unlimited.
2) Quote fee = DrawV2.vrfFeeAt(currentGasPrice).
3) DrawV2.enter(uint256 amount) (selector ${SEL_ENTER}): --to DrawV2, --value = fee (VRF fee only).
4) After the spin lands, when I ask: DrawV2.claim(): --inputData ${CLAIM_HEX}  --value 0.

${footer(`${BASE_RULES}\n${vrfRule("DrawV2")}`)}`;
      return { text, missing: missingList([["TWAK", t.missing], ["DrawV2", d.missing]]) };
    }
    case "launchClaim":
    case "genesisClaim":
    case "lotteryClaim": {
      const c = flow === "launchClaim" ? { n: "TowackLaunch", a: l, what: "my paid-mint prize (BNB refund or bonus TWAK)" } : flow === "genesisClaim" ? { n: "TowackGenesis", a: g, what: "my Genesis bonus TWAK" } : { n: "DrawV2", a: d, what: "all my owed Draw V2 pool-wheel prizes (TWAK + BNB)" };
      const text = `Claim ${c.what} on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: ${c.n} ${c.a.addr}${c.a.missing ? PENDING : ""}

1) ${c.n}.claim(): --to ${c.n} --inputData ${CLAIM_HEX}  --value 0.
   Preview first: if the preview says it would revert (nothing to claim / already claimed / claim window closed), stop and tell me.

${footer(BASE_RULES)}`;
      return { text, missing: missingList([[c.n, c.a.missing]]) };
    }
    case "referralClaim": {
      const text = `Claim my Towack referral BNB on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: TowackLaunch ${l.addr}${l.missing ? PENDING : ""}
I earn 0.005 BNB for every paid mint that named my wallet as referrer. Referral BNB never expires.

1) Optional check: TowackLaunch.referralUnclaimed(my wallet) with an eth_call. If 0, stop and tell me.
2) claimReferral(): --to TowackLaunch --inputData ${CLAIM_REFERRAL_HEX}  --value 0.

${footer(BASE_RULES)}`;
      return { text, missing: missingList([["TowackLaunch", l.missing]]) };
    }
    case "buy": {
      const p = mainnet("pancakeRouter", "<PANCAKE_V2_ROUTER>");
      const w = mainnet("wbnb", "<WBNB>");
      const text = `Buy TWAK through the Towack router on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contracts: TowackRouter ${r.addr} · TWAK ${t.addr}${r.missing || t.missing ? "  (pending mainnet deploy: do NOT send anything until Towack publishes these addresses)" : ""}
Spend: <AMOUNT_BNB_WEI> BNB (wei). The router keeps a 1% fee from the BNB in; anyone can trade.

1) Quote: PancakeSwap v2 router ${p.addr}.getAmountsOut(amount * 99 / 100, [WBNB ${w.addr}, TWAK]) (selector ${SEL_GET_AMOUNTS_OUT}) via eth_call.
   minTokensOut = quoted TWAK * (100 - my slippage %) / 100 (default 1%). deadline = now + 600 seconds (unix).
2) TowackRouter.buy(uint256 minTokensOut, uint256 deadline) (selector ${SEL_BUY}): --to TowackRouter, --value = amount in wei.

${footer(BASE_RULES)}`;
      return { text, missing: missingList([["TowackRouter", r.missing], ["TWAK", t.missing]]) };
    }
    case "sell": {
      const p = mainnet("pancakeRouter", "<PANCAKE_V2_ROUTER>");
      const w = mainnet("wbnb", "<WBNB>");
      const text = `Sell TWAK through the Towack router on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contracts: TowackRouter ${r.addr} · TWAK ${t.addr}${r.missing || t.missing ? "  (pending mainnet deploy: do NOT send anything until Towack publishes these addresses)" : ""}
Sell: <AMOUNT_TWAK_WEI> TWAK (18 decimals). The router keeps a 1% fee from the BNB out.

1) TWAK.approve(TowackRouter, amount) (selector ${SEL_APPROVE}): --to TWAK, --value 0. EXACT amount only, never unlimited / max uint.
2) Quote: PancakeSwap v2 router ${p.addr}.getAmountsOut(amount, [TWAK, WBNB ${w.addr}]) (selector ${SEL_GET_AMOUNTS_OUT}) via eth_call.
   minBnbOut = quoted BNB * 99 / 100 * (100 - my slippage %) / 100 (default 1%). deadline = now + 600 seconds (unix).
3) TowackRouter.sell(uint256 amountIn, uint256 minBnbOut, uint256 deadline) (selector ${SEL_SELL}): --to TowackRouter, --value 0.

${footer(BASE_RULES)}`;
      return { text, missing: missingList([["TowackRouter", r.missing], ["TWAK", t.missing]]) };
    }
  }
}

/** Toggle button meant to sit next to the normal wallet action. */
export function AgentPathToggle({
  flow,
  referral,
  perps,
  className = "",
}: {
  flow: AgentFlow;
  referral?: AgentReferral;
  perps?: PerpsAgentIntent;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <div className="flex justify-center">
        <Button tone="white" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">🤖</span> {open ? "Hide AI agent steps" : "Give this to your AI agent"}
        </Button>
      </div>
      {open ? <AgentPathPanel flow={flow} referral={referral} perps={perps} className="mt-4 text-left" /> : null}
    </div>
  );
}

export function AgentPathPanel({
  flow,
  referral,
  perps,
  className = "",
}: {
  flow: AgentFlow;
  referral?: AgentReferral;
  perps?: PerpsAgentIntent;
  className?: string;
}) {
  const { meta } = useTowack();
  const { text, missing } = buildInstruction(flow, referral, perps);
  const isPerps = flow === "perps";
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className={`rounded-[28px] border-4 border-navy bg-sky-pale p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="navy">BINANCE AGENTIC WALLET</Pill>
        <Pill tone="sun">MAINNET ONLY · CHAIN 56</Pill>
      </div>

      {meta.testnet ? (
        <div className="mt-4 rounded-2xl border-[3px] border-navy bg-candy-pale px-4 py-3 font-bold">
          <Pill tone="candy">NOT FOR TESTNET</Pill>
          <p className="mt-2">
            BAW does not support testnet, use MetaMask. Binance Agentic Wallet cannot connect to this page; to test here, use MetaMask or another
            browser wallet on {meta.name}. The steps below are for mainnet later; copy them for reference, not for this testnet.
          </p>
        </div>
      ) : null}

      <p className="mt-4 font-bold text-navy/80">
        Paste this into your AI agent (e.g. Claude Code) that has Binance&apos;s official{" "}
        <a className="underline" href={BAW_SKILL_URL} target="_blank" rel="noreferrer">
          binance-agentic-wallet
        </a>{" "}
        skill.{" "}
        {isPerps ? (
          <>
            Aster orders are <b>not</b> a BSC contract call, so BAW can&apos;t place them directly. BAW signs one{" "}
            <code className="rounded bg-white px-1">sign-message</code> (preview, your OK, then execute) that approves a trade-only Aster API wallet your
            agent keeps locally; that wallet signs each order after you say yes.
          </>
        ) : (
          <>
            It runs <code className="rounded bg-white px-1">baw contract-call preview</code> first and waits for your explicit OK before{" "}
            <code className="rounded bg-white px-1">execute</code>.
          </>
        )}{" "}
        This site only shows text: it never signs, never sends, and never asks for keys.
      </p>

      {missing.length > 0 ? (
        <p className="mt-3 rounded-2xl border-[3px] border-dashed border-navy bg-sun-pale px-4 py-3 font-bold">
          Mainnet contracts are not deployed yet ({missing.join(", ")}): the instruction uses placeholders. Do not send anything until Towack publishes
          the mainnet addresses.
        </p>
      ) : null}

      <pre
        className={`mt-4 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border-[3px] border-navy bg-white p-4 font-mono text-[12.5px] leading-relaxed text-navy ${meta.testnet ? "opacity-70" : ""}`}
        aria-label="Instruction for your AI agent"
      >
        {text}
      </pre>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button tone="sun" size="sm" onClick={copy}>
          {copied === "ok" ? "Copied ✓" : copied === "fail" ? "Copy failed: select the text" : meta.testnet ? "Copy mainnet steps" : "Copy for my agent"}
        </Button>
        <a className="inline-flex min-h-10 items-center text-sm font-black underline" href={TOWACK_SKILL_PATH} target="_blank" rel="noreferrer">
          Towack agent skill (SKILL.md)
        </a>
      </div>
    </div>
  );
}
