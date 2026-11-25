import { getAgent } from "@/lib/server/exchange";
import { handle, json } from "@/lib/server/http";

/** One opted-in agent by handle (e.g. zeewoo.ai). */
export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  return handle(async (db) => {
    const a = await getAgent(db, decodeURIComponent((await ctx.params).handle));
    return a ? json(a) : json({ error: "agent not found" }, 404);
  });
}
