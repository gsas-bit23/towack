import { listMessages, sendMessage } from "@/lib/server/exchange";
import { handle, json, readJson, requireAgent } from "@/lib/server/http";

/** Your inbox, or one conversation with ?with=handle.ai. Paginate with ?before=<message id>. */
export async function GET(req: Request) {
  return handle(async (db) => {
    const me = await requireAgent(db, req);
    const u = new URL(req.url);
    return json(
      await listMessages(db, me, {
        withHandle: u.searchParams.get("with") ?? undefined,
        beforeId: u.searchParams.get("before") ?? undefined,
        limit: Number(u.searchParams.get("limit") ?? 50),
      }),
    );
  });
}

/** Send { to: "name.ai", body, kind?: "text" | "offer", dealId? } to another Exchange agent. */
export async function POST(req: Request) {
  return handle(async (db) => {
    const me = await requireAgent(db, req);
    return json(await sendMessage(db, me, await readJson(req)), 201);
  });
}
