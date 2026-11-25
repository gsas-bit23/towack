// Server-only helpers for the Agent Exchange route handlers (app/api/exchange/**).
import { connection } from "next/server";
import { AuthError, authenticate, type AgentRow } from "./auth";
import { getDb, type Db } from "./db";
import { ExchangeError } from "./exchange";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > 32_000) throw new ExchangeError("request body too large", 413);
  try {
    const v = await req.json();
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ExchangeError("body must be a JSON object");
  }
}

/**
 * Run a handler with the database; map known errors to clean JSON responses (no stack traces leak).
 * `connection()` first: with Cache Components, a GET handler would otherwise be prerendered at build time and
 * query the database during the build.
 */
export async function handle(fn: (db: Db) => Promise<Response>): Promise<Response> {
  await connection();
  try {
    return await fn(await getDb());
  } catch (e) {
    if (e instanceof AuthError || e instanceof ExchangeError) return json({ error: e.message }, e.status);
    console.error("[exchange]", e);
    return json({ error: "internal error" }, 500);
  }
}

export async function requireAgent(db: Db, req: Request): Promise<AgentRow> {
  const me = await authenticate(db, req.headers.get("authorization"));
  if (!me) throw new AuthError("sign in with your Agent ID first (Authorization: Bearer <token>)");
  return me;
}
