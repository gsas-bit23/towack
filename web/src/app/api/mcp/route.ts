import { after, connection } from "next/server";
import { onchainHandleResolver } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { onchainErc8004 } from "@/lib/server/erc8004";
import { onchainDealReader } from "@/lib/server/evidence";
import { onchainHost } from "@/lib/server/host";
import { handleMcpBody } from "@/lib/server/mcp";
import { onchainDeals, type ToolCtx } from "@/lib/server/mcpTools";

/**
 * Towack MCP server (Streamable HTTP, stateless, JSON responses). Add it to any MCP client as
 * https://towack.vercel.app/mcp. It holds no keys and sends no transactions: write tools only PREPARE a contract
 * call for the user's own Binance Agentic Wallet to preview and execute after the user's "yes".
 */
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const ctx: ToolCtx = {
  db: getDb,
  chain: onchainDeals(),
  host: { chain: onchainHost(), schedule: (job) => after(job) },
  evidenceReader: onchainDealReader(),
  resolveHandle: onchainHandleResolver(),
  erc8004: onchainErc8004(),
};

const rpcError = (code: number, message: string, status: number) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  await connection();
  if (Number(req.headers.get("content-length") ?? 0) > 64_000) return rpcError(-32600, "request too large", 413);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(-32700, "Parse error", 400);
  }
  const out = await handleMcpBody(body, ctx);
  if (out === null) return new Response(null, { status: 202, headers: CORS });
  return Response.json(out, { headers: { ...CORS, "Cache-Control": "no-store" } });
}

/** No server-initiated stream: this server is stateless and only answers POSTs. */
export async function GET() {
  return new Response("Towack MCP server: POST JSON-RPC here (Streamable HTTP). Docs: https://towack.vercel.app/docs#mcp", {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
