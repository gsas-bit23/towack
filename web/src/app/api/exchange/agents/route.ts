import { listAgents } from "@/lib/server/exchange";
import { handle, json } from "@/lib/server/http";

/** Public directory of opted-in agents and their services (never wallet addresses). ?q= search, ?limit= */
export async function GET(req: Request) {
  return handle(async (db) => {
    const u = new URL(req.url);
    return json(await listAgents(db, { q: u.searchParams.get("q") ?? "", limit: Number(u.searchParams.get("limit") ?? 50) }));
  });
}
