// Public deal evidence for AgentDealsV2 judges: the terms and delivery texts whose keccak256 hashes are on-chain.
// Anyone signed in may publish a text, but it is stored only if its hash matches the deal on-chain, so it can't be
// forged. Read access is public (judges need it). No wallet addresses are stored or returned.
import { bsc } from "viem/chains";
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { ADDRESSES } from "@/config/addresses";
import type { Db } from "./db";
import { ExchangeError } from "./exchange";

export const EVIDENCE_MAX = 4000;

export type DealHashes = { termsHash: Hex; deliveryHash: Hex; status: number };
export type DealHashReader = (dealId: bigint) => Promise<DealHashes | null>;
export type Evidence = { dealId: string; terms: string | null; delivery: string | null; updatedAt: string };

const DEALS_ABI = [
  {
    type: "function",
    name: "deals",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "provider", type: "address" },
      { name: "client", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "clientAgentId", type: "uint256" },
      { name: "termsHash", type: "bytes32" },
      { name: "deliveryHash", type: "bytes32" },
      { name: "deliveryWindow", type: "uint64" },
      { name: "deadline", type: "uint64" },
      { name: "deliveredAt", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

export function dealsV2Address(): Address | undefined {
  return ADDRESSES[56].agentDealsV2;
}

/** Reads the deal's hashes from the live AgentDealsV2 contract (null if the deal does not exist). */
export function onchainDealReader(rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org"): DealHashReader {
  const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  return async (dealId) => {
    const address = dealsV2Address();
    if (!address) throw new ExchangeError("the judged deals contract is not deployed yet", 503);
    const d = await client.readContract({ address, abi: DEALS_ABI, functionName: "deals", args: [dealId] });
    return d[10] === 0 ? null : { termsHash: d[5], deliveryHash: d[6], status: d[10] };
  };
}

function parseDealId(v: unknown): bigint {
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s !== "string" || !/^\d{1,20}$/.test(s) || s === "0") throw new ExchangeError("dealId must be a positive number");
  return BigInt(s);
}

function optText(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ExchangeError(`${name} must be a string`);
  if (v.length > EVIDENCE_MAX) throw new ExchangeError(`${name} is too long (max ${EVIDENCE_MAX} characters)`);
  return v;
}

const hashOf = (text: string) => keccak256(toBytes(text));

/** Store the exact terms and/or delivery text for a deal, after checking each against its on-chain hash. */
export async function putEvidence(db: Db, read: DealHashReader, input: { dealId?: unknown; terms?: unknown; delivery?: unknown }): Promise<Evidence> {
  const id = parseDealId(input.dealId);
  const terms = optText(input.terms, "terms");
  const delivery = optText(input.delivery, "delivery");
  if (terms === undefined && delivery === undefined) throw new ExchangeError("send terms and/or delivery");
  const d = await read(id);
  if (!d) throw new ExchangeError("no such deal on-chain", 404);
  if (terms !== undefined && hashOf(terms) !== d.termsHash) throw new ExchangeError("terms text does not match the deal's on-chain termsHash");
  if (delivery !== undefined) {
    if (/^0x0{64}$/.test(d.deliveryHash)) throw new ExchangeError("the deal has not been delivered yet");
    if (hashOf(delivery) !== d.deliveryHash) throw new ExchangeError("delivery text does not match the deal's on-chain deliveryHash");
  }
  const contract = (dealsV2Address() ?? "").toLowerCase();
  const rows = await db.query<{ deal_id: string; terms: string | null; delivery: string | null; updated_at: string | Date }>(
    `INSERT INTO deal_evidence (contract, deal_id, terms, delivery) VALUES ($1, $2, $3, $4)
     ON CONFLICT (contract, deal_id) DO UPDATE SET
       terms = COALESCE(EXCLUDED.terms, deal_evidence.terms),
       delivery = COALESCE(EXCLUDED.delivery, deal_evidence.delivery),
       updated_at = now()
     RETURNING deal_id, terms, delivery, updated_at`,
    [contract, id.toString(), terms ?? null, delivery ?? null],
  );
  return toEvidence(rows[0]);
}

/** Public: evidence for up to 100 deal ids. */
export async function getEvidence(db: Db, idsParam: string | null): Promise<Evidence[]> {
  const ids = [...new Set((idsParam ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  if (ids.length > 100) throw new ExchangeError("at most 100 ids");
  const parsed = ids.map((s) => parseDealId(s).toString());
  const contract = (dealsV2Address() ?? "").toLowerCase();
  const rows = await db.query<{ deal_id: string; terms: string | null; delivery: string | null; updated_at: string | Date }>(
    `SELECT deal_id, terms, delivery, updated_at FROM deal_evidence WHERE contract = $1 AND deal_id = ANY($2::text[])`,
    [contract, parsed],
  );
  return rows.map(toEvidence);
}

function toEvidence(r: { deal_id: string; terms: string | null; delivery: string | null; updated_at: string | Date }): Evidence {
  return { dealId: r.deal_id, terms: r.terms, delivery: r.delivery, updatedAt: new Date(r.updated_at).toISOString() };
}
