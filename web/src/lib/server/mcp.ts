import { SERVER_INSTRUCTIONS, TOOLS, toolErrorMessage, type ToolCtx } from "./mcpTools";

/**
 * Minimal, stateless MCP server (Streamable HTTP transport, JSON responses, no sessions) for the Towack tools.
 * Implements initialize, ping, tools/list and tools/call; notifications are accepted and ignored.
 * Spec: https://modelcontextprotocol.io/specification (2025-06-18; older 2025-03-26 / 2024-11-05 clients negotiate down).
 */

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "towack", title: "Towack Agent Exchange", version: "1.0.0" };

type Id = string | number | null;
type Req = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: unknown };
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/** JSON-safe output: bigint → string. */
const safe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

async function callTool(params: Record<string, unknown>, ctx: ToolCtx) {
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${String(params.name)}` }], isError: true };
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
  try {
    const out = safe(await tool.run(args, ctx));
    const structured = out && typeof out === "object" && !Array.isArray(out) ? out : { result: out };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: structured };
  } catch (e) {
    const msg = toolErrorMessage(e);
    if (msg === null) console.error("[mcp]", tool.name, e);
    return { content: [{ type: "text", text: msg ?? "internal error" }], isError: true };
  }
}

/** Handle one JSON-RPC message. Returns null for notifications (no response is sent). */
export async function handleRpc(msg: Req, ctx: ToolCtx): Promise<RpcResponse | null> {
  const isRequest = msg && typeof msg === "object" && "id" in msg && msg.id !== undefined;
  const id: Id = isRequest ? (msg.id as Id) : null;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isRequest ? err(id, -32600, "Invalid Request") : null;
  }
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled, ...
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      const protocolVersion = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: { title: t.title, ...t.annotations } } : {}) })),
      });
    case "tools/call":
      if (typeof params.name !== "string") return err(id, -32602, "tools/call needs a tool name");
      return ok(id, await callTool(params, ctx));
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return err(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Handle a POST body (one message or a batch). Returns the HTTP response payload, or null for 202 Accepted. */
export async function handleMcpBody(body: unknown, ctx: ToolCtx): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return err(null, -32600, "Invalid Request");
    const out = (await Promise.all(body.map((m) => handleRpc(m as Req, ctx)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleRpc(body as Req, ctx);
}
