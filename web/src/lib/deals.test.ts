import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toFunctionSelector, zeroAddress, type Address } from "viem";
import { agentDealsV2Abi } from "@/abi";
import { ADDRESSES } from "@/config/addresses";
import {
  agentIdOfHandle,
  availableActions,
  COMMIT_WINDOW,
  failSplit,
  isFailVerdict,
  JURY_TIME,
  juryPhase,
  parseTokenAmount,
  payoutSplit,
  roleOf,
  saltFromSignature,
  scanIds,
  textHash,
  voteCommitment,
  type Deal,
} from "./deals";

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

describe("AgentDealsV2 helpers", () => {
  it("mainnet address book keeps V1 and has a V2 slot", () => {
    expect(ADDRESSES[56].agentDeals).toBe("0xc16a1941300a1b1c50eC4062836643F278a6361f");
    expect("agentDealsV2" in ADDRESSES[56]).toBe(true);
  });

  it("handle → Agent ID token id matches the registry rule (with or without .ai)", () => {
    // ownerOf(keccak256("zeewoo")) is 0x0D96…eC0d on BSC mainnet.
    expect(agentIdOfHandle("zeewoo")).toBe(0x09e3e96b96854d389f6e2284dffbaf1c372cfd2f050676469af42bd5ba52510fn);
    expect(agentIdOfHandle(" ZeeWoo.ai ")).toBe(agentIdOfHandle("zeewoo"));
  });

  it("payout split matches the contract (1% fee; +0.5% only if judges voted PASS)", () => {
    const a = 1000n * 10n ** 18n;
    expect(payoutSplit(true, a, 3)).toMatchObject({ toProvider: 985n * 10n ** 18n, toTreasury: 8n * 10n ** 18n, toDrawV2: 2n * 10n ** 18n, toJudges: 5n * 10n ** 18n });
    expect(payoutSplit(false, a, 0)).toMatchObject({ toProvider: 990n * 10n ** 18n, toTreasury: 10n * 10n ** 18n, toDrawV2: 0n, toJudges: 0n });
    const s = payoutSplit(true, 12_345n, 2);
    expect(s.toProvider + s.toTreasury + s.toDrawV2 + s.toJudges).toBe(12_345n);
    expect(failSplit(a)).toEqual({ toClient: 995n * 10n ** 18n, toJudges: 5n * 10n ** 18n });
  });

  it("verdict rule: FAIL needs 3+ revealed votes and a 2/3 FAIL supermajority", () => {
    expect(isFailVerdict(0, 2)).toBe(false);
    expect(isFailVerdict(1, 2)).toBe(true);
    expect(isFailVerdict(2, 3)).toBe(false);
    expect(isFailVerdict(2, 4)).toBe(true);
    expect(isFailVerdict(10, 19)).toBe(false);
  });

  it("vote commitment equals keccak256(abi.encode(dealId, judge, pass, salt))", () => {
    const salt = saltFromSignature("0x1234");
    const expected = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bool" }, { type: "bytes32" }], [7n, C, true, salt]));
    expect(voteCommitment(7n, C, true, salt)).toBe(expected);
    expect(voteCommitment(7n, C, false, salt)).not.toBe(expected);
  });

  it("jury phases follow delivery time", () => {
    const d: Deal = { ...base, status: "delivered", client: C, deliveredAt: 1_000 };
    expect(juryPhase(d, 1_000)).toBe("commit");
    expect(juryPhase(d, 1_000 + COMMIT_WINDOW)).toBe("reveal");
    expect(juryPhase(d, 1_000 + JURY_TIME)).toBe("finalize");
    expect(juryPhase({ ...d, status: "paid" }, 0)).toBe("settled");
    expect(juryPhase({ ...d, status: "funded" }, 0)).toBe("none");
  });

  it("parses amounts with up to 18 decimals and rejects junk", () => {
    expect(parseTokenAmount("2.5")).toBe(25n * 10n ** 17n);
    expect(parseTokenAmount("0")).toBeUndefined();
    expect(parseTokenAmount("1e3")).toBeUndefined();
  });

  it("roles: provider by address; open-offer client by Agent ID; funded client by address", () => {
    const me = agentIdOfHandle("zeewoo");
    expect(roleOf(base, P)).toBe("provider");
    expect(roleOf(base, C, me)).toBe("client");
    expect(roleOf(base, C, agentIdOfHandle("someone"))).toBe("none");
    expect(roleOf({ ...base, status: "funded", client: C }, C)).toBe("client");
  });

  it("actions mirror the contract's checks", () => {
    const now = 1_000_000;
    expect(availableActions(base, "provider", now)).toEqual(["cancel"]);
    expect(availableActions(base, "client", now)).toEqual(["accept"]);
    const funded: Deal = { ...base, status: "funded", client: C, deadline: now + 10 };
    expect(availableActions(funded, "provider", now)).toEqual(["deliver", "refundByProvider"]);
    expect(availableActions(funded, "client", now)).toEqual(["release"]);
    expect(availableActions({ ...funded, deadline: now - 1 }, "client", now)).toEqual(["release", "refund"]);
    const delivered: Deal = { ...funded, status: "delivered", deliveredAt: now - 10 };
    expect(availableActions(delivered, "provider", now)).toEqual(["refundByProvider"]); // commit phase
    expect(availableActions({ ...delivered, deliveredAt: now - COMMIT_WINDOW }, "provider", now)).toEqual([]); // reveal: locked
    expect(availableActions(delivered, "client", now)).toEqual(["release"]);
    const ready: Deal = { ...delivered, deliveredAt: now - JURY_TIME };
    expect(availableActions(ready, "provider", now)).toEqual(["finalize"]);
    expect(availableActions(ready, "client", now)).toEqual(["release", "finalize"]);
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

  it("V2 ABI has every function the UI and SKILL.md use", () => {
    const names = new Set<string>(agentDealsV2Abi.filter((x) => x.type === "function").map((x) => x.name));
    for (const sig of [
      "createOffer(address,uint256,uint256,uint64,bytes32)",
      "accept(uint256)",
      "deliver(uint256,bytes32)",
      "release(uint256)",
      "refundByProvider(uint256)",
      "refund(uint256)",
      "cancelOffer(uint256)",
      "commitVote(uint256,bytes32)",
      "revealVote(uint256,bool,bytes32)",
      "finalize(uint256)",
      "claimJudgeReward(uint256)",
      "claimJudgeRewards(uint256[])",
    ]) {
      expect(names.has(sig.slice(0, sig.indexOf("(")))).toBe(true);
      expect(toFunctionSelector(sig)).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});
