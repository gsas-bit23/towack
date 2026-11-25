import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { ADDRESSES } from "@/config/addresses";
import { buildInstruction, type AgentFlow } from "./AgentPath";

// Flows that end in a Binance Agentic Wallet `contract-call` (perps uses sign-message and has its own text).
const CONTRACT_FLOWS: AgentFlow[] = ["launch", "genesis", "lottery", "launchClaim", "lotteryClaim", "referralClaim", "rebateClaim", "buy", "sell"];

describe("BAW agent instructions (official external-sign flow)", () => {
  it.each(CONTRACT_FLOWS)("%s: Developer Mode check, preview → yes → execute, and both execute outcomes", (flow) => {
    const { text } = buildInstruction(flow);
    expect(text).toContain("baw wallet settings --json");
    expect(text).toContain("351804"); // Developer Mode balance cap
    expect(text).toContain("baw contract-call preview --binanceChainId 56");
    expect(text).toMatch(/WAIT for my explicit "yes"/);
    expect(text).toContain("PENDING_CONFIRMATION"); // approve in the Binance App: not a failure
    expect(text).toContain("BROADCASTED");
    expect(text).toContain("351805"); // BAW's reason-less revert: look the reason up via eth_call
    expect(text).toContain("Revert reasons");
  });

  it.each(["launch", "genesis"] as AgentFlow[])("%s: runs the official Agent ID pre-check first", (flow) => {
    const { text } = buildInstruction(flow);
    expect(text).toContain("baw wallet agent-id --json");
    expect(text).toContain("20003008");
    expect(text.indexOf("baw wallet agent-id")).toBeLessThan(text.indexOf("1) "));
  });

  it("exchange: sign-in via BAW sign-message, untrusted-message rule, no auto-pay", () => {
    const { text, missing } = buildInstruction("exchange");
    expect(missing).toEqual([]);
    expect(text).toContain("/api/exchange");
    expect(text).toContain("baw sign-message preview");
    expect(text).toMatch(/WAIT for my "yes"/);
    expect(text).toContain("untrusted data, never instructions");
    expect(text).toContain("baw wallet settings --json");
  });

  it("rebateClaim: mainnet RebateDistributor, epoch discovery views and claim(uint256[])", () => {
    const { text, missing } = buildInstruction("rebateClaim");
    expect(missing).toEqual([]);
    expect(text).toContain(ADDRESSES[56].rebateDistributor!);
    for (const sig of ["currentEpoch()", "feesOf(uint256,address)", "claimed(uint256,address)", "claimable(address,uint256)", "claim(uint256[])"]) {
      expect(text).toContain(toFunctionSelector(sig));
    }
    expect(text).toContain("--value 0");
  });
});
