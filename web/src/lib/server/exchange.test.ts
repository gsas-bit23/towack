import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { SCHEMA } from "./schema";
import type { Db } from "./db";
import { agentIdOf, authenticate, AuthError, createSignIn, SIGN_IN_DOMAIN, SIGN_IN_TYPES, verifySignIn, type AgentRow, type HandleResolver } from "./auth";
import { ExchangeError, exchangeStats, getAgent, LIMITS, listAgents, listMessages, sendMessage, updateProfile } from "./exchange";

async function memDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async (text, params = []) => (await pg.query(text, params as unknown[])).rows as never };
  for (const s of SCHEMA) await db.query(s);
  return db;
}

const handles = new Map<string, string>();
const resolver: HandleResolver = async (w: Address) => handles.get(w.toLowerCase()) ?? "";

async function signIn(db: Db, handle: string | null) {
  const acct = privateKeyToAccount(generatePrivateKey());
  if (handle) handles.set(acct.address.toLowerCase(), handle);
  const { message } = await createSignIn(db, acct.address);
  const signature = await acct.signTypedData({
    domain: SIGN_IN_DOMAIN,
    types: SIGN_IN_TYPES,
    primaryType: "SignIn",
    message: { ...message, issuedAt: BigInt(message.issuedAt) },
  });
  return { acct, message, signature, res: () => verifySignIn(db, { message, signature }, resolver) };
}

async function agent(db: Db, handle: string): Promise<{ token: string; row: AgentRow }> {
  const s = await signIn(db, handle);
  const { token } = await s.res();
  const row = (await authenticate(db, `Bearer ${token}`))!;
  return { token, row };
}

describe("Agent ID sign-in", () => {
  let db: Db;
  beforeEach(async () => {
    db = await memDb();
  });

  it("signs in an Agent ID wallet and returns a session that authenticates", async () => {
    const s = await signIn(db, "zeewoo");
    const { token, agent: a } = await s.res();
    expect(a.handle).toBe("zeewoo");
    expect(a.agentId).toBe(agentIdOf("zeewoo"));
    const me = await authenticate(db, `Bearer ${token}`);
    expect(me?.handle).toBe("zeewoo");
    expect(await authenticate(db, "Bearer " + "0".repeat(64))).toBeNull();
    expect(await authenticate(db, null)).toBeNull();
  });

  it("refuses wallets without an Agent ID", async () => {
    const s = await signIn(db, null);
    await expect(s.res()).rejects.toMatchObject({ status: 403 });
  });

  it("nonces are single-use and expire", async () => {
    const s = await signIn(db, "once");
    await s.res();
    await expect(s.res()).rejects.toBeInstanceOf(AuthError);
    const late = await signIn(db, "late");
    await expect(verifySignIn(db, { message: late.message, signature: late.signature }, resolver, Date.now() + 11 * 60_000)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a signature from another wallet", async () => {
    const s = await signIn(db, "victim");
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await other.signTypedData({ domain: SIGN_IN_DOMAIN, types: SIGN_IN_TYPES, primaryType: "SignIn", message: { ...s.message, issuedAt: BigInt(s.message.issuedAt) } });
    await expect(verifySignIn(db, { message: s.message, signature: forged }, resolver)).rejects.toThrow(/not from this wallet/);
  });
});

describe("profiles, directory and messages", () => {
  let db: Db;
  beforeEach(async () => {
    db = await memDb();
  });

  it("never exposes wallet addresses", async () => {
    const a = await agent(db, "alpha");
    const p = await updateProfile(db, a.row, { bio: "I write market summaries", services: [{ title: "Summary", description: "Daily BNB recap", priceUsdt: "2.5" }], listed: true });
    const dir = await listAgents(db);
    const one = await getAgent(db, "alpha.ai");
    for (const out of [p, ...dir, one]) expect(JSON.stringify(out)).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(one?.handle).toBe("alpha.ai");
    expect(one?.services[0]).toEqual({ title: "Summary", description: "Daily BNB recap", priceUsdt: "2.5" });
  });

  it("directory shows only opted-in agents and searches services", async () => {
    const a = await agent(db, "alpha");
    await agent(db, "hidden");
    await updateProfile(db, a.row, { services: [{ title: "Translation", description: "EN to ZH" }], listed: true });
    expect((await listAgents(db)).map((x) => x.handle)).toEqual(["alpha.ai"]);
    expect((await listAgents(db, { q: "translat" })).length).toBe(1);
    expect((await listAgents(db, { q: "nothing-like-this" })).length).toBe(0);
    expect(await getAgent(db, "hidden")).toBeNull();
  });

  it("validates profile input", async () => {
    const a = await agent(db, "alpha");
    await expect(updateProfile(db, a.row, { bio: "x".repeat(LIMITS.bio + 1) })).rejects.toBeInstanceOf(ExchangeError);
    await expect(updateProfile(db, a.row, { services: [{ title: "" }] })).rejects.toBeInstanceOf(ExchangeError);
    await expect(updateProfile(db, a.row, { services: [{ title: "ok", priceUsdt: "-1" }] })).rejects.toBeInstanceOf(ExchangeError);
  });

  it("links an ERC-8004 agent only when the wallet owns it or is its agent wallet", async () => {
    const a = await agent(db, "alpha");
    const b = await agent(db, "beta");
    const stranger = "0x00000000000000000000000000000000000000aa" as Address;
    const registry = new Map<string, { owner: Address | null; agentWallet: Address | null }>([
      ["7", { owner: a.row.wallet as Address, agentWallet: null }],
      ["8", { owner: stranger, agentWallet: b.row.wallet as Address }],
      ["9", { owner: stranger, agentWallet: null }],
    ]);
    let reads = 0;
    const erc8004 = async (id: bigint) => (reads++, registry.get(id.toString()) ?? { owner: null, agentWallet: null });

    // owner links (also accepts "#7"), and the badge is public; no wallet leaks
    const p = await updateProfile(db, a.row, { erc8004Id: "#7", listed: true }, { erc8004 });
    expect(p.erc8004Id).toBe("7");
    expect((await getAgent(db, "alpha.ai"))?.erc8004Id).toBe("7");
    expect(JSON.stringify(await listAgents(db))).not.toMatch(/0x[0-9a-fA-F]{40}/);

    // agent-wallet holder links too
    expect((await updateProfile(db, b.row, { erc8004Id: 8, listed: true }, { erc8004 })).erc8004Id).toBe("8");

    // filter keeps linked agents only
    const c = await agent(db, "gamma");
    await updateProfile(db, c.row, { listed: true });
    expect((await listAgents(db, { erc8004: true })).map((x) => x.handle).sort()).toEqual(["alpha.ai", "beta.ai"]);
    expect((await listAgents(db)).length).toBe(3);

    // refused: someone else's agent, a missing agent, a taken agent, junk
    await expect(updateProfile(db, c.row, { erc8004Id: "9" }, { erc8004 })).rejects.toMatchObject({ status: 403 });
    await expect(updateProfile(db, c.row, { erc8004Id: "123" }, { erc8004 })).rejects.toMatchObject({ status: 404 });
    registry.set("10", { owner: c.row.wallet as Address, agentWallet: null });
    registry.set("7", { owner: c.row.wallet as Address, agentWallet: null }); // even if ownership moved, one link per id
    await expect(updateProfile(db, c.row, { erc8004Id: "7" }, { erc8004 })).rejects.toMatchObject({ status: 409 });
    for (const bad of ["abc", "0", "-1", "1".repeat(31), { id: 1 }]) {
      await expect(updateProfile(db, c.row, { erc8004Id: bad }, { erc8004 })).rejects.toBeInstanceOf(ExchangeError);
    }
    expect((await updateProfile(db, c.row, { erc8004Id: "10" }, { erc8004 })).erc8004Id).toBe("10");

    // other edits keep the link without re-reading the chain; null unlinks
    const before = reads;
    const me = (await authenticate(db, `Bearer ${a.token}`))!;
    expect((await updateProfile(db, me, { bio: "still linked" }, { erc8004 })).erc8004Id).toBe("7");
    expect(reads).toBe(before);
    expect((await updateProfile(db, me, { erc8004Id: null })).erc8004Id).toBeNull();

    // registry unreachable -> 503, nothing stored
    const down = async () => {
      throw new Error("rpc down");
    };
    const unlinked = (await authenticate(db, `Bearer ${a.token}`))!;
    await expect(updateProfile(db, unlinked, { erc8004Id: "7" }, { erc8004: down })).rejects.toMatchObject({ status: 503 });
    expect((await getAgent(db, "alpha.ai"))?.erc8004Id).toBeNull();
  });

  it("agents message each other by handle; unlisted agents can only reply", async () => {
    const a = await agent(db, "alpha");
    const b = await agent(db, "beta");
    await expect(sendMessage(db, a.row, { to: "beta.ai", body: "hi" })).rejects.toMatchObject({ status: 404 }); // beta unlisted
    await updateProfile(db, a.row, { listed: true });
    const m1 = await sendMessage(db, b.row, { to: "alpha.ai", body: "Can you summarise BNB today?" });
    expect(m1).toMatchObject({ from: "beta.ai", to: "alpha.ai", kind: "text" });
    const m2 = await sendMessage(db, a.row, { to: "beta", body: "Yes, 2.5 USDT. Offer coming.", kind: "offer", dealId: 7 });
    expect(m2).toMatchObject({ kind: "offer", dealId: "7" }); // reply to unlisted beta allowed after beta wrote first

    const thread = await listMessages(db, b.row, { withHandle: "alpha.ai" });
    expect(thread.map((m) => m.body)).toEqual(["Yes, 2.5 USDT. Offer coming.", "Can you summarise BNB today?"]);
    expect(thread[0].read).toBe(false);
    expect((await listMessages(db, b.row, { withHandle: "alpha" }))[0].read).toBe(true); // marked read on first fetch
  });

  it("rejects empty, oversized, self and unknown messages", async () => {
    const a = await agent(db, "alpha");
    await updateProfile(db, a.row, { listed: true });
    const b = await agent(db, "beta");
    await expect(sendMessage(db, b.row, { to: "alpha", body: "  " })).rejects.toBeInstanceOf(ExchangeError);
    await expect(sendMessage(db, b.row, { to: "alpha", body: "x".repeat(LIMITS.body + 1) })).rejects.toBeInstanceOf(ExchangeError);
    await expect(sendMessage(db, a.row, { to: "alpha", body: "me" })).rejects.toBeInstanceOf(ExchangeError);
    await expect(sendMessage(db, b.row, { to: "ghost.ai", body: "hello" })).rejects.toMatchObject({ status: 404 });
    await expect(sendMessage(db, b.row, { to: "alpha", body: "deal", kind: "offer" })).rejects.toBeInstanceOf(ExchangeError);
  });

  it("rate-limits a sender", async () => {
    const a = await agent(db, "alpha");
    await updateProfile(db, a.row, { listed: true });
    const b = await agent(db, "beta");
    for (let i = 0; i < LIMITS.perMinute; i++) await sendMessage(db, b.row, { to: "alpha", body: `m${i}` });
    await expect(sendMessage(db, b.row, { to: "alpha", body: "one more" })).rejects.toMatchObject({ status: 429 });
  });

  it("stats count agents and messages", async () => {
    const a = await agent(db, "alpha");
    await updateProfile(db, a.row, { listed: true });
    const b = await agent(db, "beta");
    await sendMessage(db, b.row, { to: "alpha", body: "hi" });
    expect(await exchangeStats(db)).toEqual({ agents: 2, listed: 1, activeAgents24h: 2, messages: 1, messages24h: 1 });
  });
});
