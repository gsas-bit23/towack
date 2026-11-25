import { describe, expect, it } from "vitest";
import { toFunctionSelector, zeroAddress, type Address } from "viem";
import { agentDealsAbi } from "@/abi";
import { ADDRESSES } from "@/config/addresses";
import { agentIdOfHandle, availableActions, feeSplit, parseTokenAmount, REVIEW_WINDOW, roleOf, scanIds, textHash, type Deal } from "./deals";

const P = "0x56a9813E93363fb5141bdDD332f9BBbdC955e2b8" as Address;
const C = "0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d" as Address;
const base: Deal = {
  id: 1n,
  provider: P,
  client: zeroAddress,
  token: zeroAddress,
  amount: 10n ** 18n,
  clientAgentId: agentIdOfHandle("zeewoo"),
  termsHash: textHash("terms"),
  deliveryHash: "0x",
  deliveryWindow: 86_400,
  deadline: 0,
  deliveredAt: 0,
  status: "open",
};

describe("AgentDeals helpers", () => {
  it("mainnet address book has AgentDeals", () => {
    expect(ADDRESSES[56].agentDeals).toBe("0xc16a1941300a1b1c50eC4062836643F278a6361f");
  });

  it("handle → Agent ID token id matches the registry rule (with or without .ai)", () => {
    // ownerOf(keccak256("zeewoo")) is 0x0D96…eC0d on BSC mainnet.
    expect(agentIdOfHandle("zeewoo")).toBe(0x09e3e96b96854d389f6e2284dffbaf1c372cfd2f050676469af42bd5ba52510fn);
    expect(agentIdOfHandle(" ZeeWoo.ai ")).toBe(agentIdOfHandle("zeewoo"));
    expect(agentIdOfHandle("zeewoo.ai")).toBe(agentIdOfHandle("zeewoo"));
  });

  it("fee split matches the contract (1%; 0.2% to Draw V2 only for TWAK)", () => {
    const a = 1000n * 10n ** 18n;
    expect(feeSplit(true, a)).toEqual({ toProvider: 990n * 10n ** 18n, toTreasury: 8n * 10n ** 18n, toDrawV2: 2n * 10n ** 18n, fee: 10n * 10n ** 18n });
    expect(feeSplit(false, a)).toEqual({ toProvider: 990n * 10n ** 18n, toTreasury: 10n * 10n ** 18n, toDrawV2: 0n, fee: 10n * 10n ** 18n });
    const odd = 12_345n;
    const s = feeSplit(true, odd);
    expect(s.toProvider + s.toTreasury + s.toDrawV2).toBe(odd);
  });

  it("parses amounts with up to 18 decimals and rejects junk", () => {
    expect(parseTokenAmount("2.5")).toBe(25n * 10n ** 17n);
    expect(parseTokenAmount("0")).toBeUndefined();
    expect(parseTokenAmount("1e3")).toBeUndefined();
    expect(parseTokenAmount("")).toBeUndefined();
  });

  it("roles: provider by address; open-offer client by Agent ID; funded client by address", () => {
    const me = agentIdOfHandle("zeewoo");
    expect(roleOf(base, P)).toBe("provider");
    expect(roleOf(base, C, me)).toBe("client");
    expect(roleOf(base, C, agentIdOfHandle("someone"))).toBe("none");
    expect(roleOf({ ...base, status: "funded", client: C }, C)).toBe("client");
    expect(roleOf(base, undefined)).toBe("none");
  });

  it("actions mirror the contract's checks", () => {
    const now = 1_000_000;
    expect(availableActions(base, "provider", now)).toEqual(["cancel"]);
    expect(availableActions(base, "client", now)).toEqual(["accept"]);
    const funded: Deal = { ...base, status: "funded", client: C, deadline: now + 10 };
    expect(availableActions(funded, "provider", now)).toEqual(["deliver", "refundByProvider"]);
    expect(availableActions(funded, "client", now)).toEqual(["release"]);
    expect(availableActions({ ...funded, deadline: now - 1 }, "client", now)).toEqual(["release", "refund"]);
    expect(availableActions({ ...funded, deadline: now - 1 }, "provider", now)).toEqual(["refundByProvider"]);
    const delivered: Deal = { ...funded, status: "delivered", deliveredAt: now - REVIEW_WINDOW + 5 };
    expect(availableActions(delivered, "provider", now)).toEqual(["refundByProvider"]);
    expect(availableActions({ ...delivered, deliveredAt: now - REVIEW_WINDOW }, "provider", now)).toEqual(["claim", "refundByProvider"]);
    expect(availableActions(delivered, "client", now)).toEqual(["release"]);
    for (const s of ["paid", "refunded", "cancelled"] as const) {
      expect(availableActions({ ...base, status: s }, "provider", now)).toEqual([]);
      expect(availableActions({ ...base, status: s }, "client", now)).toEqual([]);
    }
  });

  it("scans newest deals first, capped", () => {
    expect(scanIds(3n)).toEqual([3n, 2n, 1n]);
    expect(scanIds(0n)).toEqual([]);
    expect(scanIds(500n, 2)).toEqual([500n, 499n]);
  });

  it("ABI selectors match the ones documented in SKILL.md", () => {
    const names = new Set<string>(agentDealsAbi.filter((x) => x.type === "function").map((x) => x.name));
    for (const [sig, sel] of [
      ["createOffer(address,uint256,uint256,uint64,bytes32)", "0x3ed93cfd"],
      ["accept(uint256)", "0x19b05f49"],
      ["deliver(uint256,bytes32)", "0xd9b42a7f"],
      ["release(uint256)", "0x37bdc99b"],
      ["claimPayment(uint256)", "0xc63fdcc7"],
      ["refundByProvider(uint256)", "0x2e2680c8"],
      ["refund(uint256)", "0x278ecde1"],
      ["cancelOffer(uint256)", "0xef706adf"],
    ] as const) {
      expect(toFunctionSelector(sig)).toBe(sel);
      expect(names.has(sig.slice(0, sig.indexOf("(")))).toBe(true);
    }
  });
});
