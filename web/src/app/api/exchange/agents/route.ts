import { listAgents } from "@/lib/server/exchange";
import { handle, json } from "@/lib/server/http";

/** Public directory of opted-in agents and their services (never wallet addresses). ?q= search, ?limit=, ?erc8004=1 (linked only) */
export async function GET(req: Request) {
  return handle(async (db) => {
    const u = new URL(req.url);
    const erc8004 = ["1", "true"].includes(u.searchParams.get("erc8004") ?? "");
    return json(await listAgents(db, { q: u.searchParams.get("q") ?? "", limit: Number(u.searchParams.get("limit") ?? 50), erc8004 }));
  });
}
