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
    ["currentEpoch()", "0x76671808"],
    ["feesOf(uint256,address)", "0x6ccd6cfa"],
    ["claimed(uint256,address)", "0x120aa877"],
    ["claimable(address,uint256)", "0x60efe334"],
    ["claim(uint256[])", "0x6ba4c138"],
    ["mint(address)", "0x6a627842"],
    ["mintByHandle()", "0x748049f4"],
    ["enter(uint256)", "0xa59f3e0c"],
    ["vrfFeeAt(uint256)", "0xa3eaf9d8"],
  ])("flow selector %s is %s and appears in the skill", (sig, selector) => {
    expect(toFunctionSelector(sig)).toBe(selector);
    expect(SKILL).toContain(selector);
  });
});
