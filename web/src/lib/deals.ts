import { encodeAbiParameters, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";

/** AgentDealsV2 (src/AgentDealsV2.sol) constants and pure helpers shared by the /exchange Deals + Judge tabs. */

export const FEE_BPS = 100n; // 1% protocol fee, only when the provider is paid
export const DRAW_FEE_BPS = 20n; // 0.2% of a TWAK deal seeds Draw V2 (USDT deals: the whole 1% goes to the treasury)
export const JUDGE_FEE_BPS = 50n; // 0.5% to the judges on the winning side
export const BPS = 10_000n;
export const MIN_WINDOW = 3600; // 1 hour
export const MAX_WINDOW = 60 * 24 * 3600; // 60 days
export const COMMIT_WINDOW = 48 * 3600; // sealed votes, starting at delivery
export const REVEAL_WINDOW = 24 * 3600; // then votes are opened
export const JURY_TIME = COMMIT_WINDOW + REVEAL_WINDOW;
export const QUORUM = 3;
export const TOKEN_DECIMALS = 18; // BSC USDT and TWAK are both 18 decimals

export const DEAL_STATUS = ["none", "open", "funded", "delivered", "paid", "refunded", "cancelled"] as const;
export type DealStatus = (typeof DEAL_STATUS)[number];

/** On-chain `deals(id)` tuple, in Solidity field order. */
export type DealTuple = readonly [
  provider: Address,
  client: Address,
  token: Address,
  amount: bigint,
  clientAgentId: bigint,
  termsHash: Hex,
  deliveryHash: Hex,
  deliveryWindow: bigint,
  deadline: bigint,
  deliveredAt: bigint,
  status: number,
];

/** On-chain `juries(id)` tuple. */
export type JuryTuple = readonly [commits: number, passVotes: number, failVotes: number, verdict: number, rewardPool: bigint, rewardPerJudge: bigint];
/** On-chain `ballots(id, judge)` tuple. */
export type BallotTuple = readonly [commitment: Hex, revealed: boolean, pass: boolean, claimed: boolean];

export type Deal = {
  id: bigint;
  provider: Address;
  client: Address;
  token: Address;
  amount: bigint;
  clientAgentId: bigint;
  termsHash: Hex;
  deliveryHash: Hex;
  deliveryWindow: number;
  deadline: number;
  deliveredAt: number;
  status: DealStatus;
};

export type Jury = { commits: number; passVotes: number; failVotes: number; verdict: "none" | "pass" | "fail"; rewardPerJudge: bigint };

export function toDeal(id: bigint, t: DealTuple): Deal {
  return {
    id,
    provider: t[0],
    client: t[1],
    token: t[2],
    amount: t[3],
    clientAgentId: t[4],
    termsHash: t[5],
    deliveryHash: t[6],
    deliveryWindow: Number(t[7]),
    deadline: Number(t[8]),
    deliveredAt: Number(t[9]),
    status: DEAL_STATUS[t[10]] ?? "none",
  };
}

export function toJury(t?: JuryTuple): Jury {
  if (!t) return { commits: 0, passVotes: 0, failVotes: 0, verdict: "none", rewardPerJudge: 0n };
  return { commits: Number(t[0]), passVotes: Number(t[1]), failVotes: Number(t[2]), verdict: (["none", "pass", "fail"] as const)[t[3]] ?? "none", rewardPerJudge: t[5] };
}

/** Agent ID token id for a handle, as the SPACE ID HandleRegistry computes it: keccak256(bytes(handle)), no ".ai". */
export function bareHandle(handle: string): string {
  return handle.trim().toLowerCase().replace(/\.ai$/, "");
}
export function agentIdOfHandle(handle: string): bigint {
  return BigInt(keccak256(toBytes(bareHandle(handle))));
}

/** Hash of the agreed terms / delivery note, exactly as stored on-chain (keccak256 of the UTF-8 text). */
export function textHash(text: string): Hex {
  return keccak256(toBytes(text));
}

/** Same math as AgentDealsV2.payoutSplit (PASS). `passJudges` = judges who revealed PASS. */
export function payoutSplit(isTwak: boolean, amount: bigint, passJudges = 0) {
  const fee = (amount * FEE_BPS) / BPS;
  const toDrawV2 = isTwak ? (amount * DRAW_FEE_BPS) / BPS : 0n;
  const toJudges = passJudges > 0 ? (amount * JUDGE_FEE_BPS) / BPS : 0n;
  return { toProvider: amount - fee - toJudges, toTreasury: fee - toDrawV2, toDrawV2, toJudges, fee };
}

/** FAIL verdict split: the client gets everything but the 0.5% judge fee. */
export function failSplit(amount: bigint) {
  const toJudges = (amount * JUDGE_FEE_BPS) / BPS;
  return { toClient: amount - toJudges, toJudges };
}

/** Same rule as AgentDealsV2.isFailVerdict: FAIL needs a quorum of 3 revealed votes and a 2/3 FAIL supermajority. */
export function isFailVerdict(passVotes: number, failVotes: number): boolean {
  const total = passVotes + failVotes;
  return total >= QUORUM && failVotes * 3 >= total * 2;
}

/** Sealed vote, same as AgentDealsV2.voteCommitment: keccak256(abi.encode(dealId, judge, pass, salt)). */
export function voteCommitment(dealId: bigint, judge: Address, pass: boolean, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bool" }, { type: "bytes32" }], [dealId, judge, pass, salt]));
}

/** Message a judge signs to derive a recoverable vote salt (a signature can't move funds). */
export function saltMessage(contract: Address, dealId: bigint): string {
  return `Towack judge vote salt\nContract: ${contract}\nDeal: #${dealId}\nThis signature only seals your vote. It cannot move funds.`;
}
export function saltFromSignature(sig: Hex): Hex {
  return keccak256(sig);
}

export type JuryPhase = "none" | "commit" | "reveal" | "finalize" | "settled";
export function juryPhase(d: Deal, now: number): JuryPhase {
  if (d.status === "paid" || d.status === "refunded" || d.status === "cancelled") return "settled";
  if (d.status !== "delivered") return "none";
  if (now < d.deliveredAt + COMMIT_WINDOW) return "commit";
  if (now < d.deliveredAt + JURY_TIME) return "reveal";
  return "finalize";
}

/** Parses a user-typed token amount (18 decimals); undefined for empty, malformed or zero. */
export function parseTokenAmount(v: string): bigint | undefined {
  const s = v.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(s)) return undefined;
  const n = parseUnits(s, TOKEN_DECIMALS);
  return n > 0n ? n : undefined;
}

export type Role = "provider" | "client" | "none";
export type DealAction = "cancel" | "accept" | "deliver" | "release" | "finalize" | "refundByProvider" | "refund";

/**
 * Which buttons the contract would accept right now for this wallet. Mirrors the require checks in AgentDealsV2:
 * the UI never offers a call that is certain to revert.
 */
export function availableActions(d: Deal, role: Role, now: number): DealAction[] {
  const out: DealAction[] = [];
  const phase = juryPhase(d, now);
  if (role === "provider") {
    if (d.status === "open") out.push("cancel");
    if (d.status === "funded" && now <= d.deadline) out.push("deliver");
    if (d.status === "funded" || phase === "commit") out.push("refundByProvider");
  } else if (role === "client") {
    if (d.status === "open") out.push("accept");
    if (d.status === "funded" || d.status === "delivered") out.push("release");
    if (d.status === "funded" && now > d.deadline) out.push("refund");
  }
  if (role !== "none" && phase === "finalize") out.push("finalize");
  return out;
}

/** Role of `wallet` in a deal. For an open offer the client is whoever owns `clientAgentId` (passed in as `myAgentId`). */
export function roleOf(d: Deal, wallet?: Address, myAgentId?: bigint): Role {
  if (!wallet) return "none";
  const w = wallet.toLowerCase();
  if (d.provider.toLowerCase() === w) return "provider";
  if (d.status === "open") return myAgentId !== undefined && d.clientAgentId === myAgentId ? "client" : "none";
  return d.client.toLowerCase() === w ? "client" : "none";
}

export const WINDOW_PRESETS = [
  { key: "1h", seconds: 3600 },
  { key: "1d", seconds: 86_400 },
  { key: "3d", seconds: 3 * 86_400 },
  { key: "7d", seconds: 7 * 86_400 },
  { key: "14d", seconds: 14 * 86_400 },
  { key: "30d", seconds: 30 * 86_400 },
] as const;

/** How many of the most recent deals the page scans (no indexer: reads deals(id) by multicall). */
export const SCAN_LIMIT = 200;
export function scanIds(dealCount: bigint, limit = SCAN_LIMIT): bigint[] {
  const ids: bigint[] = [];
  for (let i = dealCount; i >= 1n && ids.length < limit; i--) ids.push(i);
  return ids;
}
