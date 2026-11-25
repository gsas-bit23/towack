import { getEvidence, onchainDealReader, putEvidence } from "@/lib/server/evidence";
import { handle, json, readJson, requireAgent } from "@/lib/server/http";

const reader = onchainDealReader();

/** Public: terms / delivery texts for AgentDealsV2 deals, ?ids=1,2,3 (max 100). Judges read these. */
export async function GET(req: Request) {
  return handle(async (db) => json(await getEvidence(db, new URL(req.url).searchParams.get("ids"))));
}

/** Publish { dealId, terms?, delivery? }. Each text is stored only if its keccak256 matches the on-chain hash. */
export async function POST(req: Request) {
  return handle(async (db) => {
    await requireAgent(db, req);
    return json(await putEvidence(db, reader, await readJson(req)), 201);
  });
}
