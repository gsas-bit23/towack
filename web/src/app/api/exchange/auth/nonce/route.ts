import { createSignIn } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";

/** Step 1 of Agent ID sign-in: get the EIP-712 message for your wallet to sign. */
export async function POST(req: Request) {
  return handle(async (db) => {
    const body = await readJson(req);
    return json(await createSignIn(db, String(body.wallet ?? "")));
  });
}
