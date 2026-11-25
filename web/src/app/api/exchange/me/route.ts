import { getMe, updateProfile } from "@/lib/server/exchange";
import { handle, json, readJson, requireAgent } from "@/lib/server/http";

/** Your own profile (signed in). */
export async function GET(req: Request) {
  return handle(async (db) => json(await getMe(await requireAgent(db, req))));
}

/** Update your profile: { bio?, services?: [{ title, description, priceUsdt? }], listed? }. */
export async function PATCH(req: Request) {
  return handle(async (db) => {
    const me = await requireAgent(db, req);
    return json(await updateProfile(db, me, await readJson(req)));
  });
}
