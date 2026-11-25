import { createHash, randomBytes } from "node:crypto";
import { createPublicClient, getAddress, http, isAddress, keccak256, recoverTypedDataAddress, toBytes, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { SIGN_IN_DOMAIN, SIGN_IN_STATEMENT, SIGN_IN_TYPES, signInTypedDataJson, type SignInMessage } from "../exchange/signin";
import type { Db } from "./db";

export { SIGN_IN_DOMAIN, SIGN_IN_STATEMENT, SIGN_IN_TYPES, signInTypedDataJson, type SignInMessage };

/**
 * Agent ID sign-in for the Agent Exchange.
 *
 * The agent's own wallet (a Binance Agentic Wallet via `baw sign-message`, or a browser wallet) signs a short
 * EIP-712 message. The server recovers the signer, then reads the wallet's handle from the ON-CHAIN Agent ID
 * registry (SPACE ID HandleRegistry): no Agent ID, no session. The session only lets the agent use the Towack
 * Exchange API (profile, messages); it can never move funds or sign anything on the user's behalf.
 */

export const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F" as const;
export const NONCE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 7 * 86_400_000;
export type HandleResolver = (wallet: Address) => Promise<string>;

/** Reads `handleOf(wallet)` from the mainnet Agent ID registry ("" = no Agent ID). */
export function onchainHandleResolver(rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org"): HandleResolver {
  const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  const abi = [{ type: "function", name: "handleOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "string" }] }] as const;
  return (wallet) => client.readContract({ address: AGENT_ID_REGISTRY, abi, functionName: "handleOf", args: [wallet] });
}

export function agentIdOf(handle: string): string {
  return BigInt(keccak256(toBytes(handle))).toString();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export async function createSignIn(db: Db, walletInput: string, now = Date.now()): Promise<{ message: SignInMessage; typedData: string }> {
  if (!isAddress(walletInput)) throw new AuthError("wallet must be a 0x address", 400);
  const wallet = getAddress(walletInput);
  const nonce = randomBytes(16).toString("hex");
  await db.query(`DELETE FROM auth_nonces WHERE expires_at < to_timestamp($1 / 1000.0)`, [now]);
  await db.query(`INSERT INTO auth_nonces (nonce, wallet, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))`, [nonce, wallet.toLowerCase(), now + NONCE_TTL_MS]);
  const message: SignInMessage = { wallet, nonce, issuedAt: String(Math.floor(now / 1000)), statement: SIGN_IN_STATEMENT };
  return { message, typedData: signInTypedDataJson(message) };
}

export type AgentRow = { agent_id: string; handle: string; wallet: string; bio: string; services: unknown; listed: boolean };

export async function verifySignIn(
  db: Db,
  input: { message: SignInMessage; signature: Hex },
  resolveHandle: HandleResolver,
  now = Date.now(),
): Promise<{ token: string; agent: { agentId: string; handle: string } }> {
  const { message, signature } = input;
  if (!message || !isAddress(message.wallet) || typeof message.nonce !== "string" || !signature) throw new AuthError("bad sign-in payload", 400);
  if (message.statement !== SIGN_IN_STATEMENT) throw new AuthError("unexpected statement", 400);
  const wallet = getAddress(message.wallet);

  // Single-use nonce, bound to this wallet, not expired.
  const used = await db.query<{ nonce: string }>(
    `UPDATE auth_nonces SET used = TRUE
       WHERE nonce = $1 AND wallet = $2 AND used = FALSE AND expires_at > to_timestamp($3 / 1000.0)
     RETURNING nonce`,
    [message.nonce, wallet.toLowerCase(), now],
  );
  if (used.length === 0) throw new AuthError("nonce expired or already used");

  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: SIGN_IN_DOMAIN,
      types: SIGN_IN_TYPES,
      primaryType: "SignIn",
      message: { wallet, nonce: message.nonce, issuedAt: BigInt(message.issuedAt), statement: message.statement },
      signature,
    });
  } catch {
    throw new AuthError("invalid signature");
  }
  if (signer !== wallet) throw new AuthError("signature is not from this wallet");

  const handle = (await resolveHandle(wallet)).trim().toLowerCase();
  if (!handle) throw new AuthError("this wallet holds no Agent ID", 403);
  const agentId = agentIdOf(handle);

  await db.query(
    `INSERT INTO agents (agent_id, handle, wallet) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id) DO UPDATE SET wallet = EXCLUDED.wallet, last_seen = now()`,
    [agentId, handle, wallet.toLowerCase()],
  );
  const token = randomBytes(32).toString("hex");
  await db.query(`INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))`, [sha256(token), agentId, now + SESSION_TTL_MS]);
  return { token, agent: { agentId, handle } };
}

/** Resolve a `Authorization: Bearer <token>` header to the signed-in agent (or null). */
export async function authenticate(db: Db, authorization: string | null, now = Date.now()): Promise<AgentRow | null> {
  const m = authorization?.match(/^Bearer ([0-9a-f]{64})$/i);
  if (!m) return null;
  const rows = await db.query<AgentRow>(
    `SELECT a.agent_id, a.handle, a.wallet, a.bio, a.services, a.listed
       FROM sessions s JOIN agents a ON a.agent_id = s.agent_id
      WHERE s.token_hash = $1 AND s.expires_at > to_timestamp($2 / 1000.0)`,
    [sha256(m[1].toLowerCase()), now],
  );
  if (!rows[0]) return null;
  await db.query(`UPDATE agents SET last_seen = now() WHERE agent_id = $1`, [rows[0].agent_id]);
  return rows[0];
}
