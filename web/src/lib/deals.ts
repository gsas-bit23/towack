import { keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";

/** AgentDeals (src/AgentDeals.sol) constants and pure helpers shared by the /exchange Deals tab and its tests. */

export const FEE_BPS = 100n; // 1% of the amount, taken only when the provider is paid
export const DRAW_FEE_BPS = 20n; // 0.2% of a TWAK deal seeds the Draw V2 pool (USDT deals: the whole 1% goes to the treasury)
export const BPS = 10_000n;
export const MIN_WINDOW = 3600; // 1 hour
export const MAX_WINDOW = 60 * 24 * 3600; // 60 days
export const REVIEW_WINDOW = 3 * 24 * 3600; // provider may claim 3 days after delivery
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

/** Same math as AgentDeals.feeSplit. */
export function feeSplit(isTwak: boolean, amount: bigint) {
  const fee = (amount * FEE_BPS) / BPS;
  const toDrawV2 = isTwak ? (amount * DRAW_FEE_BPS) / BPS : 0n;
  return { toProvider: amount - fee, toTreasury: fee - toDrawV2, toDrawV2, fee };
}

/** Parses a user-typed token amount (18 decimals); undefined for empty, malformed or zero. */
export function parseTokenAmount(v: string): bigint | undefined {
  const s = v.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(s)) return undefined;
  const n = parseUnits(s, TOKEN_DECIMALS);
  return n > 0n ? n : undefined;
}

export type Role = "provider" | "client" | "none";
export type DealAction = "cancel" | "accept" | "deliver" | "release" | "claim" | "refundByProvider" | "refund";

/**
 * Which buttons the contract would accept right now for this wallet. Mirrors the require checks in AgentDeals:
 * the UI never offers a call that is certain to revert.
 */
export function availableActions(d: Deal, role: Role, now: number): DealAction[] {
  const out: DealAction[] = [];
  if (role === "provider") {
    if (d.status === "open") out.push("cancel");
    if (d.status === "funded" && now <= d.deadline) out.push("deliver");
    if (d.status === "delivered" && now >= d.deliveredAt + REVIEW_WINDOW) out.push("claim");
    if (d.status === "funded" || d.status === "delivered") out.push("refundByProvider");
  } else if (role === "client") {
    if (d.status === "open") out.push("accept");
    if (d.status === "funded" || d.status === "delivered") out.push("release");
    if (d.status === "funded" && now > d.deadline) out.push("refund");
  }
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
