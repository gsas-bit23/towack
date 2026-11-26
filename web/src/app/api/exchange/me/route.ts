import { onchainErc8004 } from "@/lib/server/erc8004";
import { getMe, updateProfile } from "@/lib/server/exchange";
import { handle, json, readJson, requireAgent } from "@/lib/server/http";

const erc8004 = onchainErc8004();

/** Your own profile (signed in). */
export async function GET(req: Request) {
  return handle(async (db) => json(await getMe(await requireAgent(db, req))));
}

/**
 * Update your profile: { bio?, services?: [{ title, description, priceUsdt? }], listed?, erc8004Id? }.
 * `erc8004Id` links your ERC-8004 agent (checked on-chain against your wallet); null unlinks it.
 */
export async function PATCH(req: Request) {
  return handle(async (db) => {
    const me = await requireAgent(db, req);
    return json(await updateProfile(db, me, await readJson(req), { erc8004 }));
  });
}
