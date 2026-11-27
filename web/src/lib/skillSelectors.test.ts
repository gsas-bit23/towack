import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";

// The Towack agent skill is hand-written markdown: recompute every selector it states so a typo fails CI.
const SKILL = readFileSync(path.resolve(import.meta.dirname, "../../public/skills/towack/SKILL.md"), "utf8");

/** "VrfFeeTooLow(uint256 sent, uint256 required)" -> "VrfFeeTooLow(uint256,uint256)" */
const canonical = (sig: string) => {
  const [name, args] = sig.split("(");
  const types = args
    .replace(/\)$/, "")
    .split(",")
    .map((a) => a.trim().split(/\s+/)[0])
    .filter(Boolean);
  return `${name}(${types.join(",")})`;
};

describe("Towack SKILL.md selectors", () => {
  const rows = [...SKILL.matchAll(/^\| `(0x[0-9a-f]{8})` \| `(\w+\([^`]*\))` \|/gm)];

  it("has a Revert reasons table", () => {
    expect(SKILL).toContain("## Revert reasons");
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it.each(rows.map((m) => [m[2], m[1]]))("%s = %s", (sig, selector) => {
    expect(toFunctionSelector(canonical(sig))).toBe(selector);
  });

  it.each([
    ["mintByHandle()", "0x748049f4"],
    ["enter(uint256)", "0xa59f3e0c"],
    ["vrfFeeAt(uint256)", "0xa3eaf9d8"],
    ["createOffer(address,uint256,uint256,uint64,bytes32)", "0x3ed93cfd"],
    ["accept(uint256)", "0x19b05f49"],
    ["commitVote(uint256,bytes32)", "0x9da69180"],
    ["revealVote(uint256,bool,bytes32)", "0xfacc092f"],
    ["finalize(uint256)", "0x05261aea"],
    ["claimJudgeReward(uint256)", "0xdf3423ff"],
  ])("flow selector %s is %s and appears in the skill", (sig, selector) => {
    expect(toFunctionSelector(sig)).toBe(selector);
    expect(SKILL).toContain(selector);
  });

  // The paid mint closed with zero mints (allocation burned) and the V2 pair never opened: the skill must not send
  // agents into the paid mint, referral, rebate or router buy/sell flows any more.
  it.each([
    ["mint(address)", "0x6a627842"],
    ["claimReferral()", "0xe02f1ebd"],
    ["claim(uint256[])", "0x6ba4c138"],
    ["buy(uint256,uint256)", "0xd6febde8"],
    ["sell(uint256,uint256,uint256)", "0xd3c9727c"],
  ])("removed flow %s (%s) is gone from the skill", (sig, selector) => {
    expect(toFunctionSelector(sig)).toBe(selector);
    expect(SKILL).not.toContain(selector);
  });
});
