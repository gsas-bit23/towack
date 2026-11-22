"use client";

import { useState } from "react";
import { encodeFunctionData, toFunctionSelector } from "viem";
import { ADDRESSES } from "@/config/addresses";
import { useTowack } from "@/lib/chain";
import { Button, Pill } from "./ui";

/**
 * "Use with your AI agent": copyable instructions for Binance Agentic Wallet (BAW) users.
 *
 * BAW is MAINNET-ONLY (chain 56) and cannot connect to web pages, so this site never signs, never broadcasts and
 * never runs the BAW CLI: it only displays text the user pastes into their own AI agent (which has Binance's
 * official `binance-agentic-wallet` skill). Addresses come from addresses.json chain 56 only; empty ones are shown
 * as visible placeholders ("pending mainnet deploy"), never invented.
 */

export type AgentFlow = "launch" | "genesis" | "lottery";

const BAW_SKILL_URL = "https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet";
const TOWACK_SKILL_PATH = "/skills/towack/SKILL.md";
const MINT_PRICE_WEI = "100000000000000000"; // 0.1 BNB

const NO_ARGS = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;
const MINT_NOARG_HEX = encodeFunctionData({ abi: NO_ARGS, functionName: "mint" });
const CLAIM_HEX = encodeFunctionData({ abi: NO_ARGS, functionName: "claim" });
const SEL_GENESIS_MINT = toFunctionSelector("mint(uint256)");
const SEL_APPROVE = toFunctionSelector("approve(address,uint256)");
const SEL_ENTER = toFunctionSelector("enter(uint256)");
const SEL_VRF_FEE_AT = toFunctionSelector("vrfFeeAt(uint256)");

function mainnet(key: "launch" | "genesis" | "drawV2" | "token", placeholder: string) {
  const a = ADDRESSES[56][key];
  return { addr: a ?? placeholder, missing: !a };
}

const COMMON_RULES = (contract: string) => `Rules (Binance Agentic Wallet, official external-sign flow):
- BNB Smart Chain MAINNET only: --binanceChainId 56. Towack's website never signs for me; you prepare, I confirm.
- Before any contract-call, run \`baw wallet settings --json\` and confirm devMode.enabled=true. If it is off, tell me to enable Developer Mode in the Binance App and WAIT.
- For every transaction: \`baw contract-call preview --binanceChainId 56 --from <my wallet> --to <contract> --value <wei> --inputData <hex> --json\`.
  Show me the parsed tx, the risks and the authorityChanges, then WAIT for my explicit "yes".
  Only then: \`baw contract-call execute --requestId <requestId> --json\`.
- --value is raw wei (an integer). Do not pass a gas price.
- VRF fee: read ${contract}.vrfFeeAt(gasPrice) (selector ${SEL_VRF_FEE_AT}) with an eth_call at the current BSC gas price. Underpaying reverts; any excess is refunded by the contract in the same tx.`;

function buildInstruction(flow: AgentFlow): { text: string; missing: string[] } {
  if (flow === "launch") {
    const l = mainnet("launch", "<TOWACK_LAUNCH>");
    const text = `Towack paid mint on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: TowackLaunch ${l.addr}${l.missing ? "  (pending mainnet deploy: do NOT send anything until Towack publishes this address)" : ""}
Requirement: my wallet must hold an Agent ID (one mint per Agent ID wallet).

1) Quote fee = TowackLaunch.vrfFeeAt(currentGasPrice).
2) mint(): --inputData ${MINT_NOARG_HEX}  --value = ${MINT_PRICE_WEI} + fee  (0.1 BNB + VRF fee, in wei).
3) After the spin lands (Chainlink VRF), when I ask: claim(): --inputData ${CLAIM_HEX}  --value 0.

${COMMON_RULES("TowackLaunch")}
Towack skill: ${TOWACK_SKILL_PATH} on the Towack site.`;
    return { text, missing: l.missing ? ["TowackLaunch"] : [] };
  }
  if (flow === "genesis") {
    const g = mainnet("genesis", "<TOWACK_GENESIS>");
    const text = `Towack Genesis 300 free mint on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contract: TowackGenesis ${g.addr}${g.missing ? "  (pending mainnet deploy: do NOT send anything until Towack publishes this address)" : ""}
Requirement: my wallet must own the Agent ID token I name (one Genesis per Agent ID and per wallet).

1) Quote fee = TowackGenesis.vrfFeeAt(currentGasPrice).
2) mint(uint256 agentTokenId) (selector ${SEL_GENESIS_MINT}): ABI-encode my Agent ID token id as --inputData; --value = fee (no mint price, VRF fee only).
3) After the spin lands, when I ask: claim(): --inputData ${CLAIM_HEX}  --value 0.

${COMMON_RULES("TowackGenesis")}
Towack skill: ${TOWACK_SKILL_PATH} on the Towack site.`;
    return { text, missing: g.missing ? ["TowackGenesis"] : [] };
  }
  const d = mainnet("drawV2", "<TOWACK_DRAWV2>");
  const t = mainnet("token", "<TOWACK_TWAK>");
  const pending = d.missing || t.missing;
  const text = `Towack Draw V2 pool wheel entry on BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Contracts: TWAK ${t.addr} · DrawV2 ${d.addr}${pending ? "  (pending mainnet deploy: do NOT send anything until Towack publishes these addresses)" : ""}
Anyone can enter (no Agent ID needed). Amount: <AMOUNT_TWAK_WEI> (18 decimals, minimum entry applies).

1) TWAK.approve(DrawV2, amount) (selector ${SEL_APPROVE}): --to TWAK, --value 0. Exact amount only, never unlimited.
2) Quote fee = DrawV2.vrfFeeAt(currentGasPrice).
3) DrawV2.enter(uint256 amount) (selector ${SEL_ENTER}): --to DrawV2, --value = fee (VRF fee only).
4) After the spin lands, when I ask: DrawV2.claim(): --inputData ${CLAIM_HEX}  --value 0.

${COMMON_RULES("DrawV2")}
Towack skill: ${TOWACK_SKILL_PATH} on the Towack site.`;
  return { text, missing: [...(t.missing ? ["TWAK"] : []), ...(d.missing ? ["DrawV2"] : [])] };
}

/** Toggle button meant to sit next to the normal wallet connect. */
export function AgentPathToggle({ flow, className = "" }: { flow: AgentFlow; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <div className="flex justify-center">
        <Button tone="white" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">🤖</span> {open ? "Hide AI agent steps" : "Use with your AI agent"}
        </Button>
      </div>
      {open ? <AgentPathPanel flow={flow} className="mt-4 text-left" /> : null}
    </div>
  );
}

export function AgentPathPanel({ flow, className = "" }: { flow: AgentFlow; className?: string }) {
  const { meta } = useTowack();
  const { text, missing } = buildInstruction(flow);
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
            Binance Agentic Wallet does not support BSC testnet and cannot connect to this page. To test here, use MetaMask or another browser wallet
            on {meta.name}. The steps below are for mainnet later; copy them for reference, not for this testnet.
          </p>
        </div>
      ) : null}

      <p className="mt-4 font-bold text-navy/80">
        Paste this into your AI agent (e.g. Claude Code) that has Binance&apos;s official{" "}
        <a className="underline" href={BAW_SKILL_URL} target="_blank" rel="noreferrer">
          binance-agentic-wallet
        </a>{" "}
        skill. It previews every transaction and waits for your explicit OK before executing. This site only shows text: it never signs, never
        sends, and never asks for keys.
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
