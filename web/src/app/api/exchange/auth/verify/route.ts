import type { Hex } from "viem";
import { onchainHandleResolver, verifySignIn, type SignInMessage } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";

const resolver = onchainHandleResolver();

/** Step 2: send the signed message back; get a session token if the wallet holds an Agent ID. */
export async function POST(req: Request) {
  return handle(async (db) => {
    const body = await readJson(req);
    const out = await verifySignIn(db, { message: body.message as SignInMessage, signature: String(body.signature ?? "") as Hex }, resolver);
    return json(out);
  });
}
