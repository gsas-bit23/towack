import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentDealsV2Abi } from "@/abi";
import { ADDRESSES } from "@/config/addresses";
import { voteCommitment, type Deal } from "@/lib/deals";
import { SIGN_IN_DOMAIN, SIGN_IN_TYPES, type HandleResolver } from "./auth";
import type { Db } from "./db";
import type { HostChain } from "./host";
import { handleMcpBody, handleRpc, SUPPORTED_VERSIONS } from "./mcp";
import { TOOLS, USDT, type DealRead, type DealsChain, type ToolCtx } from "./mcpTools";
import { SCHEMA } from "./schema";

const DEALS = ADDRESSES[56].agentDealsV2! as Address;
const TWAK = ADDRESSES[56].token as Address;
const NOW = 2_000_000_000;
/** A wallet address (exactly 40 hex chars, not the start of a 32-byte hash). */
const ADDR = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const PROVIDER = "0x00000000000000000000000000000000000000a1" as Address;
const CLIENT = "0x00000000000000000000000000000000000000c1" as Address;

async function memDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async (text, params = []) => (await pg.query(text, params as unknown[])).rows as never };
  for (const s of SCHEMA) await db.query(s);
  return db;
}

function deal(id: bigint, over: Partial<Deal> = {}): DealRead {
  return {
    deal: {
      id,
      provider: PROVIDER,
      client: CLIENT,
      token: USDT,
      amount: 25n * 10n ** 18n,
      clientAgentId: 1n,
      termsHash: keccak256(toBytes("terms")),
      deliveryHash: keccak256(toBytes("delivery")),
      deliveryWindow: 86_400,
      deadline: NOW + 86_400,
      deliveredAt: 0,
      status: "funded",
      ...over,
    },
    jury: { commits: 0, passVotes: 0, failVotes: 0, verdict: "none", rewardPerJudge: 0n },
  };
}

const handles = new Map<string, string>();
const resolver: HandleResolver = async (w) => handles.get(w.toLowerCase()) ?? "";
const hostChain: HostChain = {
  latestBlock: async () => 135_683_100n,
  voteLogs: async () => [],
  deals: async () => [],
  usdt: async () => USDT,
  txCount: async () => 99,
};

describe("Towack MCP server", () => {
  let db: Db;
  let ctx: ToolCtx;
  let chainDeals: Record<string, DealRead>;

  beforeEach(async () => {
    db = await memDb();
    chainDeals = {};
    const chain: DealsChain = {
      dealCount: async () => BigInt(Object.keys(chainDeals).length),
      deals: async (ids) => ids.map((id) => chainDeals[id.toString()] ?? null),
    };
    ctx = {
      db: async () => db,
      chain,
      host: { chain: hostChain, now: NOW, schedule: () => {} },
      evidenceReader: async () => null,
      resolveHandle: resolver,
      erc8004: async () => ({ owner: null, agentWallet: null }),
      now: () => NOW,
    };
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx);
    return r!.result as { content: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  };

  it("initializes, negotiates the protocol version and gives safety instructions", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, ctx);
    const res = r!.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string }; instructions: string };
    expect(res.protocolVersion).toBe("2025-03-26");
    expect(res.capabilities.tools).toBeDefined();
    expect(res.serverInfo.name).toBe("towack");
    expect(res.instructions).toMatch(/never signs or sends/);
    const newer = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, ctx);
    expect((newer!.result as { protocolVersion: string }).protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  it("ignores notifications, answers batches, rejects junk", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).toBeNull();
    const batch = await handleMcpBody([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 7, method: "ping" }], ctx);
    expect(batch).toEqual([{ jsonrpc: "2.0", id: 7, result: {} }]);
    expect((await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, ctx))!.error!.code).toBe(-32601);
    expect((await handleRpc({ id: 4, method: "ping" } as never, ctx))!.error!.code).toBe(-32600);
    expect((await call("no_such_tool")).isError).toBe(true);
  });

  it("lists every tool with an object input schema; write tools are prepare-only", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    const tools = (r!.result as { tools: { name: string; inputSchema: { type: string }; description: string }[] }).tools;
    expect(tools.length).toBe(TOOLS.length);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    // No tool can send a transaction: every on-chain tool is a prepare_* builder.
    expect(tools.filter((t) => /send|execute|transfer/i.test(t.name) && t.name !== "send_message")).toEqual([]);
  });

  it("finds listed agents without ever returning a wallet", async () => {
    await db.query(`INSERT INTO agents (agent_id, handle, wallet, bio, services, listed) VALUES ('1', 'zeewoo', '0x0d96e8aa89c196d3b1b0100cdae3b931e8a0ec0d', 'Builder agent', '[{"title":"Contract read-through","description":"x","priceUsdt":"15"}]', TRUE)`);
    const r = await call("find_agents", { query: "contract" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("zeewoo.ai");
    expect(r.content[0].text).not.toMatch(ADDR);
    expect((await call("get_agent", { handle: "zeewoo.ai" })).content[0].text).toContain("Builder agent");
  });

  it("reads deals and jury cases without party addresses; shows your role", async () => {
    chainDeals["1"] = deal(1n, { status: "delivered", deliveredAt: NOW - 3600 }); // sealed voting
    chainDeals["2"] = deal(2n, { status: "funded" }); // no jury
    chainDeals["3"] = deal(3n, { status: "delivered", deliveredAt: NOW - 50 * 3600, token: TWAK }); // reveal
    const d = await call("get_deals", { dealIds: ["1", "2"], myWallet: CLIENT });
    expect(d.content[0].text).not.toMatch(ADDR);
    const rows = (d.structuredContent as { result: { dealId: string; juryPhase: string; yourRole: string; amount: string }[] }).result;
    expect(rows[0]).toMatchObject({ dealId: "1", juryPhase: "commit", yourRole: "client", amount: "25" });
    const cases = (await call("list_jury_cases", {})).structuredContent as { cases: { dealId: string; juryPhase: string; token: string }[] };
    expect(cases.cases.map((c) => c.dealId).sort()).toEqual(["1", "3"]);
    expect(cases.cases.find((c) => c.dealId === "3")).toMatchObject({ juryPhase: "reveal", token: "TWAK" });
    // A party to the deal doesn't see it as a case to judge.
    const mine = (await call("list_jury_cases", { myWallet: PROVIDER })).structuredContent as { cases: unknown[] };
    expect(mine.cases).toEqual([]);
    expect((await call("get_deals", { dealIds: ["0"] })).isError).toBe(true);
  });

  it("prepares exact, decodable calls and never signs", async () => {
    const accept = (await call("prepare_deal_action", { action: "accept", dealId: "12" })).structuredContent as { to: string; data: Hex; value: string; nextStep: string };
    expect(accept.to).toBe(DEALS);
    expect(accept.value).toBe("0");
    expect(accept.data).toBe(encodeFunctionData({ abi: agentDealsV2Abi, functionName: "accept", args: [12n] }));
    expect(accept.nextStep).toMatch(/explicit "yes"/);

    const appr = (await call("prepare_token_approval", { token: "TWAK", amount: "2.5" })).structuredContent as { to: string; data: Hex };
    expect(appr.to).toBe(TWAK);
    const dec = decodeFunctionData({ abi: erc20Abi, data: appr.data });
    expect(dec.functionName).toBe("approve");
    expect(dec.args).toEqual([DEALS, 25n * 10n ** 17n]); // exact, never max uint

    const offer = (await call("prepare_create_offer", { token: "USDT", amount: "25", clientHandle: "Zeewoo.ai", deliveryHours: 24, terms: "Write a brief." })).structuredContent as { data: Hex; termsHash: Hex };
    const o = decodeFunctionData({ abi: agentDealsV2Abi, data: offer.data });
    expect(o.functionName).toBe("createOffer");
    expect(o.args).toEqual([USDT, 25n * 10n ** 18n, BigInt(keccak256(toBytes("zeewoo"))), 86_400n, keccak256(toBytes("Write a brief."))]);
    expect(offer.termsHash).toBe(keccak256(toBytes("Write a brief.")));

    const deliver = (await call("prepare_deal_action", { action: "deliver", dealId: "5", delivery: "https://x/brief.pdf" })).structuredContent as { data: Hex };
    expect(decodeFunctionData({ abi: agentDealsV2Abi, data: deliver.data }).args).toEqual([5n, keccak256(toBytes("https://x/brief.pdf"))]);

    for (const bad of [
      { name: "prepare_create_offer", args: { token: "BNB", amount: "1", clientHandle: "a", deliveryHours: 24, terms: "t" } },
      { name: "prepare_create_offer", args: { token: "USDT", amount: "1", clientHandle: "a", deliveryHours: 0.5, terms: "t" } },
      { name: "prepare_token_approval", args: { token: "USDT", amount: "0" } },
      { name: "prepare_deal_action", args: { action: "drain", dealId: "1" } },
      { name: "prepare_deal_action", args: { action: "deliver", dealId: "1" } },
    ]) {
      expect((await call(bad.name, bad.args)).isError).toBe(true);
    }
  });

  it("seals and reveals votes with the contract's commitment formula", async () => {
    const judge = "0x00000000000000000000000000000000000000d1" as Address;
    const salt = keccak256(toBytes("my secret salt"));
    const c = (await call("prepare_commit_vote", { dealId: "9", judgeWallet: judge, pass: false, salt })).structuredContent as { data: Hex; commitment: Hex };
    expect(c.commitment).toBe(voteCommitment(9n, judge, false, salt));
    expect(decodeFunctionData({ abi: agentDealsV2Abi, data: c.data }).args).toEqual([9n, c.commitment]);
    // Precomputed commitment passes straight through (the server never needs your vote or salt).
    const pre = (await call("prepare_commit_vote", { dealId: "9", commitment: c.commitment })).structuredContent as { commitment: Hex };
    expect(pre.commitment).toBe(c.commitment);
    expect((await call("prepare_commit_vote", { dealId: "9", judgeWallet: judge, pass: true, salt: "0x1234" })).isError).toBe(true);
    const rev = (await call("prepare_reveal_vote", { dealId: "9", pass: false, salt })).structuredContent as { data: Hex };
    expect(decodeFunctionData({ abi: agentDealsV2Abi, data: rev.data }).args).toEqual([9n, false, salt]);
    const claim = (await call("prepare_claim_judge_rewards", { dealIds: ["3", "4"] })).structuredContent as { data: Hex };
    expect(decodeFunctionData({ abi: agentDealsV2Abi, data: claim.data }).args).toEqual([[3n, 4n]]);
  });

  it("signs in with an Agent ID wallet and uses the session; bad sessions are refused", async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    handles.set(acct.address.toLowerCase(), "tester");
    const start = (await call("sign_in_start", { wallet: acct.address })).structuredContent as { message: { issuedAt: string } & Record<string, string>; bawMessage: string };
    expect(JSON.parse(start.bawMessage).method).toBe("eth_signTypedData_v4");
    const signature = await acct.signTypedData({ domain: SIGN_IN_DOMAIN, types: SIGN_IN_TYPES, primaryType: "SignIn", message: { ...start.message, issuedAt: BigInt(start.message.issuedAt) } as never });
    const fin = (await call("sign_in_finish", { message: start.message, signature })).structuredContent as { session: string; agent: { handle: string } };
    expect(fin.agent.handle).toBe("tester.ai");
    const me = await call("get_my_profile", { session: fin.session });
    expect(me.content[0].text).toContain("tester.ai");
    expect(me.content[0].text).not.toMatch(ADDR);
    const upd = await call("update_my_profile", { session: fin.session, bio: "I judge deals", listed: true });
    expect(upd.content[0].text).toContain("I judge deals");
    const bad = await call("get_my_profile", { session: "f".repeat(64) });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/sign in again/);
  });
});
