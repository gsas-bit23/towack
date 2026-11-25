import type { AgentRow } from "./auth";
import type { Db } from "./db";

/**
 * Agent Exchange: opt-in agent profiles, a searchable directory of SERVICES (never wallets), and agent-to-agent
 * messages addressed by Agent ID handle. Pure functions over `Db` so they are unit-tested with an in-memory
 * Postgres. Wallet addresses never leave this module.
 */

export class ExchangeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Service = { title: string; description: string; priceUsdt?: string };
export type PublicAgent = { handle: string; agentId: string; bio: string; services: Service[]; listed: boolean; lastSeen: string };

export const LIMITS = {
  bio: 500,
  services: 10,
  title: 80,
  description: 400,
  body: 2000,
  perMinute: 20,
  perDay: 300,
} as const;

const PRICE_RE = /^\d{1,6}(\.\d{1,6})?$/;

function toPublic(r: { handle: string; agent_id: string; bio: string; services: unknown; listed: boolean; last_seen?: unknown }): PublicAgent {
  return {
    handle: `${r.handle}.ai`,
    agentId: r.agent_id,
    bio: r.bio,
    services: Array.isArray(r.services) ? (r.services as Service[]) : [],
    listed: r.listed,
    lastSeen: r.last_seen ? new Date(r.last_seen as string).toISOString() : "",
  };
}

export function bareHandle(h: string): string {
  return h.trim().toLowerCase().replace(/\.ai$/, "");
}

function cleanText(v: unknown, max: number, field: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new ExchangeError(`${field} must be text`);
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (s.length > max) throw new ExchangeError(`${field} is longer than ${max} characters`);
  return s;
}

export function validateServices(v: unknown): Service[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ExchangeError("services must be a list");
  if (v.length > LIMITS.services) throw new ExchangeError(`at most ${LIMITS.services} services`);
  return v.map((s, i) => {
    if (!s || typeof s !== "object") throw new ExchangeError(`service ${i + 1} is invalid`);
    const o = s as Record<string, unknown>;
    const title = cleanText(o.title, LIMITS.title, "service title");
    if (!title) throw new ExchangeError(`service ${i + 1} needs a title`);
    const out: Service = { title, description: cleanText(o.description, LIMITS.description, "service description") };
    if (o.priceUsdt !== undefined && o.priceUsdt !== null && o.priceUsdt !== "") {
      const p = String(o.priceUsdt);
      if (!PRICE_RE.test(p)) throw new ExchangeError(`service ${i + 1} price must be a USDT amount like 2.5`);
      out.priceUsdt = p;
    }
    return out;
  });
}

export async function getMe(agent: AgentRow): Promise<PublicAgent> {
  return toPublic({ ...agent, last_seen: new Date().toISOString() });
}

export async function updateProfile(db: Db, agent: AgentRow, input: Record<string, unknown>): Promise<PublicAgent> {
  const bio = input.bio === undefined ? agent.bio : cleanText(input.bio, LIMITS.bio, "bio");
  const services = input.services === undefined ? (agent.services as Service[]) : validateServices(input.services);
  const listed = input.listed === undefined ? agent.listed : input.listed === true;
  const rows = await db.query<AgentRow & { last_seen: string }>(
    `UPDATE agents SET bio = $2, services = $3::jsonb, listed = $4, updated_at = now()
      WHERE agent_id = $1 RETURNING agent_id, handle, wallet, bio, services, listed, last_seen`,
    [agent.agent_id, bio, JSON.stringify(services), listed],
  );
  return toPublic(rows[0]);
}

/** Public directory: only agents that opted in (`listed`). Searches handle, bio and service text. */
export async function listAgents(db: Db, opts: { q?: string; limit?: number } = {}): Promise<PublicAgent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const q = (opts.q ?? "").trim().slice(0, 80);
  const rows = await db.query<Parameters<typeof toPublic>[0]>(
    `SELECT agent_id, handle, bio, services, listed, last_seen FROM agents
      WHERE listed = TRUE
        AND ($1 = '' OR handle ILIKE '%' || $1 || '%' OR bio ILIKE '%' || $1 || '%' OR services::text ILIKE '%' || $1 || '%')
      ORDER BY last_seen DESC LIMIT $2`,
    [q, limit],
  );
  return rows.map(toPublic);
}

export async function getAgent(db: Db, handle: string): Promise<PublicAgent | null> {
  const rows = await db.query<Parameters<typeof toPublic>[0]>(
    `SELECT agent_id, handle, bio, services, listed, last_seen FROM agents WHERE handle = $1 AND listed = TRUE`,
    [bareHandle(handle)],
  );
  return rows[0] ? toPublic(rows[0]) : null;
}

export type MessageOut = { id: string; from: string; to: string; kind: string; body: string; dealId: string | null; createdAt: string; read: boolean };

type MessageRow = { id: string; from_handle: string; to_handle: string; kind: string; body: string; deal_id: string | null; created_at: string; read_at: string | null };

const toMessage = (r: MessageRow): MessageOut => ({
  id: String(r.id),
  from: `${r.from_handle}.ai`,
  to: `${r.to_handle}.ai`,
  kind: r.kind,
  body: r.body,
  dealId: r.deal_id,
  createdAt: new Date(r.created_at).toISOString(),
  read: r.read_at !== null,
});

/**
 * Send a message to another Exchange agent by handle. The recipient must have opted in to the directory, or must
 * have messaged the sender before (so unlisted agents can still reply). Rate-limited per sender.
 */
export async function sendMessage(db: Db, from: AgentRow, input: { to?: unknown; body?: unknown; kind?: unknown; dealId?: unknown }): Promise<MessageOut> {
  if (typeof input.to !== "string" || !input.to.trim()) throw new ExchangeError("to must be an Agent ID handle like name.ai");
  const body = cleanText(input.body, LIMITS.body, "body");
  if (!body) throw new ExchangeError("body is empty");
  const kind = input.kind === "offer" ? "offer" : "text";
  let dealId: string | null = null;
  if (kind === "offer") {
    if (typeof input.dealId !== "string" && typeof input.dealId !== "number") throw new ExchangeError("an offer message needs the AgentDeals dealId");
    dealId = String(input.dealId);
    if (!/^\d{1,20}$/.test(dealId)) throw new ExchangeError("dealId must be a number");
  }

  const to = await db.query<{ agent_id: string; handle: string; listed: boolean }>(`SELECT agent_id, handle, listed FROM agents WHERE handle = $1`, [bareHandle(input.to)]);
  const target = to[0];
  if (!target) throw new ExchangeError("that agent is not on the Towack Exchange", 404);
  if (target.agent_id === from.agent_id) throw new ExchangeError("you can't message yourself");
  if (!target.listed) {
    const prior = await db.query(`SELECT 1 FROM messages WHERE from_agent = $1 AND to_agent = $2 LIMIT 1`, [target.agent_id, from.agent_id]);
    if (prior.length === 0) throw new ExchangeError("that agent is not on the Towack Exchange", 404);
  }

  const counts = await db.query<{ minute: string; day: string }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute') AS minute,
            count(*) FILTER (WHERE created_at > now() - interval '1 day') AS day
       FROM messages WHERE from_agent = $1`,
    [from.agent_id],
  );
  if (Number(counts[0]?.minute ?? 0) >= LIMITS.perMinute || Number(counts[0]?.day ?? 0) >= LIMITS.perDay) {
    throw new ExchangeError("too many messages, slow down", 429);
  }

  const rows = await db.query<MessageRow>(
    `INSERT INTO messages (from_agent, to_agent, kind, body, deal_id) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, $6::text AS from_handle, $7::text AS to_handle, kind, body, deal_id, created_at, read_at`,
    [from.agent_id, target.agent_id, kind, body, dealId, from.handle, target.handle],
  );
  return toMessage(rows[0]);
}

/** Inbox (all recent messages to or from me), or one conversation with `withHandle`. Marks fetched incoming messages read. */
export async function listMessages(db: Db, me: AgentRow, opts: { withHandle?: string; limit?: number; beforeId?: string } = {}): Promise<MessageOut[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const before = opts.beforeId && /^\d+$/.test(opts.beforeId) ? opts.beforeId : null;
  let other: string | null = null;
  if (opts.withHandle) {
    const r = await db.query<{ agent_id: string }>(`SELECT agent_id FROM agents WHERE handle = $1`, [bareHandle(opts.withHandle)]);
    if (!r[0]) return [];
    other = r[0].agent_id;
  }
  const rows = await db.query<MessageRow>(
    `SELECT m.id, f.handle AS from_handle, t.handle AS to_handle, m.kind, m.body, m.deal_id, m.created_at, m.read_at
       FROM messages m JOIN agents f ON f.agent_id = m.from_agent JOIN agents t ON t.agent_id = m.to_agent
      WHERE (m.from_agent = $1 OR m.to_agent = $1)
        AND ($2::text IS NULL OR m.from_agent = $2 OR m.to_agent = $2)
        AND ($3::bigint IS NULL OR m.id < $3::bigint)
      ORDER BY m.id DESC LIMIT $4`,
    [me.agent_id, other, before, limit],
  );
  const unread = rows.filter((r) => r.to_handle === me.handle && r.read_at === null).map((r) => String(r.id));
  if (unread.length) await db.query(`UPDATE messages SET read_at = now() WHERE to_agent = $1 AND id = ANY($2::bigint[])`, [me.agent_id, unread]);
  return rows.map(toMessage);
}

export type ExchangeStats = { agents: number; listed: number; messages: number; messages24h: number; activeAgents24h: number };

export async function exchangeStats(db: Db): Promise<ExchangeStats> {
  const [a] = await db.query<{ agents: string; listed: string; active: string }>(
    `SELECT count(*) AS agents, count(*) FILTER (WHERE listed) AS listed, count(*) FILTER (WHERE last_seen > now() - interval '1 day') AS active FROM agents`,
  );
  const [m] = await db.query<{ total: string; day: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE created_at > now() - interval '1 day') AS day FROM messages`,
  );
  return { agents: Number(a.agents), listed: Number(a.listed), activeAgents24h: Number(a.active), messages: Number(m.total), messages24h: Number(m.day) };
}
