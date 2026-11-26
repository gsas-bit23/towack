// Host agent orchestrator: alarms (from an incremental index of public vote events) + one advisor opinion per deal.
// Read-only toward the chain: no key, no transaction, no power over any deal. The API never returns wallet addresses.
import { createPublicClient, http, keccak256, toBytes, type Address } from "viem";
import { bsc } from "viem/chains";
import { agentDealsV2Abi } from "@/abi";
import { ADDRESSES } from "@/config/addresses";
import type { Db } from "./db";
import { ExchangeError } from "./exchange";
import { computeAlarms, type Alarm, type JudgeSignal, type JuryFacts } from "./hostAlarms";
import { advisorEnabled, type AdvisorInput, type AdvisorResult, type Opinion } from "./hostAdvisor";

export const DEALS_V2_DEPLOY_BLOCK = 135683066n;
export const LOG_CHUNK = 9_000n; // public BSC RPCs cap eth_getLogs at 10,000 blocks
export const MAX_CHUNKS_PER_CALL = 40; // ~360k blocks (~45h at 0.45s blocks) of catch-up per request
const COMMIT_WINDOW = 48 * 3600;
const JURY_TIME = 72 * 3600;
const PENDING_STALE_MS = 5 * 60_000;
const FAILED_RETRY_MS = 60 * 60_000;
const NONCE_TTL_MS = 6 * 3600_000;
export const DAILY_OPINIONS = Number(process.env.HOST_DAILY_OPINIONS ?? 30);

export type VoteLog = { kind: "commit" | "reveal"; dealId: bigint; judge: Address; pass?: boolean };
export type ChainDeal = {
  provider: Address;
  token: Address;
  amount: bigint;
  deliveredAt: number;
  status: number; // 0 none 1 open 2 funded 3 delivered 4 paid 5 refunded 6 cancelled
  commits: number;
  passVotes: number;
  failVotes: number;
};
export interface HostChain {
  latestBlock(): Promise<bigint>;
  voteLogs(fromBlock: bigint, toBlock: bigint): Promise<VoteLog[]>;
  deals(ids: bigint[]): Promise<(ChainDeal | null)[]>;
  usdt(): Promise<Address>;
  txCount(addr: Address): Promise<number>;
}

export type HostOpinion = Pick<Opinion, "verdict" | "confidence" | "summary_en" | "summary_zh" | "reasons_en" | "reasons_zh"> & {
  manipulation: boolean;
  model: string | null;
  createdAt: string;
};
export type HostReport = {
  dealId: string;
  phase: JuryFacts["phase"];
  alarms: Alarm[];
  advisor: { status: "none" | "pending" | "done" | "failed" | "refused" | "disabled"; opinion?: HostOpinion };
  indexedTo: string; // block the vote index has reached
};

function contractAddr(): Address {
  const a = ADDRESSES[56].agentDealsV2;
  if (!a) throw new ExchangeError("the judged deals contract is not deployed", 503);
  return a;
}

export function onchainHost(rpcUrl = process.env.BSC_LOGS_RPC_URL || "https://bsc-rpc.publicnode.com"): HostChain {
  const client = createPublicClient({ chain: bsc, transport: http(rpcUrl, { batch: true, retryCount: 2 }) });
  const committed = agentDealsV2Abi.find((x) => x.type === "event" && x.name === "VoteCommitted")!;
  const revealed = agentDealsV2Abi.find((x) => x.type === "event" && x.name === "VoteRevealed")!;
  return {
    latestBlock: () => client.getBlockNumber(),
    async voteLogs(fromBlock, toBlock) {
      const logs = await client.getLogs({ address: contractAddr(), events: [committed, revealed] as never, fromBlock, toBlock });
      return (logs as unknown as { eventName: string; args: { dealId: bigint; judge: Address; pass?: boolean } }[]).map((l) => ({
        kind: l.eventName === "VoteCommitted" ? "commit" : "reveal",
        dealId: l.args.dealId,
        judge: l.args.judge,
        pass: l.args.pass,
      }));
    },
    async deals(ids) {
      const c = { address: contractAddr(), abi: agentDealsV2Abi } as const;
      const res = await client.multicall({
        contracts: ids.flatMap((id) => [
          { ...c, functionName: "deals" as const, args: [id] as const },
          { ...c, functionName: "juries" as const, args: [id] as const },
        ]),
      });
      return ids.map((_, i) => {
        const d = res[i * 2]?.result as readonly unknown[] | undefined;
        const j = res[i * 2 + 1]?.result as readonly unknown[] | undefined;
        if (!d || !j || Number(d[10]) === 0) return null;
        return {
          provider: d[0] as Address,
          token: d[2] as Address,
          amount: d[3] as bigint,
          deliveredAt: Number(d[9]),
          status: Number(d[10]),
          commits: Number(j[0]),
          passVotes: Number(j[1]),
          failVotes: Number(j[2]),
        };
      });
    },
    usdt: () => client.readContract({ address: contractAddr(), abi: agentDealsV2Abi, functionName: "usdt" }) as Promise<Address>,
    txCount: (addr) => client.getTransactionCount({ address: addr }),
  };
}

/** Parallel eth_getLogs calls per batch, and the time a request may spend catching up before it answers. */
export const LOG_PARALLEL = 10;
export const INDEX_BUDGET_MS = 15_000;

/**
 * Catch the shared vote index up toward the chain head. Bounded per call by chunks and by time, and saves progress
 * after every batch, so a long idle gap never holds a request near the function time limit. Safe to run concurrently.
 */
export async function advanceIndex(
  db: Db,
  chain: HostChain,
  contract: string,
  maxChunks = MAX_CHUNKS_PER_CALL,
  budgetMs = INDEX_BUDGET_MS,
): Promise<{ indexedTo: bigint; caughtUp: boolean }> {
  const started = Date.now();
  const rows = await db.query<{ last_block: string }>(`SELECT last_block FROM host_index WHERE contract = $1`, [contract]);
  const last = rows[0] ? BigInt(rows[0].last_block) : DEALS_V2_DEPLOY_BLOCK - 1n;
  if (!rows[0]) await db.query(`INSERT INTO host_index (contract, last_block) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [contract, last.toString()]);
  const head = await chain.latestBlock();
  const target = head - 3n; // stay a few blocks behind the head
  if (target <= last) return { indexedTo: last, caughtUp: true };

  const ranges: [bigint, bigint][] = [];
  for (let from = last + 1n; from <= target && ranges.length < maxChunks; from += LOG_CHUNK) {
    ranges.push([from, from + LOG_CHUNK - 1n > target ? target : from + LOG_CHUNK - 1n]);
  }
  let done = last;
  for (let i = 0; i < ranges.length; i += LOG_PARALLEL) {
    if (i > 0 && Date.now() - started > budgetMs) break;
    const batch = ranges.slice(i, i + LOG_PARALLEL);
    const part = await Promise.all(batch.map(([a, b]) => chain.voteLogs(a, b)));
    await storeVotes(db, contract, part.flat());
    done = batch[batch.length - 1][1];
    await db.query(`UPDATE host_index SET last_block = GREATEST(last_block, $2), updated_at = now() WHERE contract = $1`, [contract, done.toString()]);
  }
  return { indexedTo: done, caughtUp: done >= target };
}

async function storeVotes(db: Db, contract: string, logs: VoteLog[]): Promise<void> {
  for (const l of logs) {
    const key = [contract, l.dealId.toString(), l.judge.toLowerCase()];
    if (l.kind === "commit") {
      await db.query(
        `INSERT INTO host_votes (contract, deal_id, judge, committed) VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (contract, deal_id, judge) DO UPDATE SET committed = TRUE`,
        key,
      );
    } else {
      await db.query(
        `INSERT INTO host_votes (contract, deal_id, judge, committed, revealed, pass) VALUES ($1, $2, $3, TRUE, TRUE, $4)
         ON CONFLICT (contract, deal_id, judge) DO UPDATE SET revealed = TRUE, pass = EXCLUDED.pass`,
        [...key, Boolean(l.pass)],
      );
    }
  }
}

export function phaseOf(d: ChainDeal | null, now: number): JuryFacts["phase"] {
  if (!d) return "none";
  if (d.status >= 4) return d.deliveredAt > 0 ? "settled" : "none";
  if (d.status !== 3) return "none";
  if (now < d.deliveredAt + COMMIT_WINDOW) return "commit";
  if (now < d.deliveredAt + JURY_TIME) return "reveal";
  return "finalize";
}

const inputHash = (terms: string, delivery: string) => keccak256(toBytes(`${terms}\u0000${delivery}`));

type OpinionRow = {
  deal_id: string;
  status: string;
  verdict: string | null;
  confidence: string | null;
  summary_en: string | null;
  summary_zh: string | null;
  reasons_en: string[] | null;
  reasons_zh: string[] | null;
  manipulation: boolean | null;
  model: string | null;
  input_hash: string | null;
  created_at: string | Date;
};

export type HostDeps = {
  chain: HostChain;
  now?: number;
  /** Runs the advisor after the response is sent (Next `after()` in production, inline in tests). */
  schedule?: (job: () => Promise<void>) => void;
  write?: (input: AdvisorInput) => Promise<AdvisorResult>;
};

function parseIds(param: string | null): bigint[] {
  const ids = [...new Set((param ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  if (ids.length > 20) throw new ExchangeError("at most 20 ids");
  return ids.map((s) => {
    if (!/^\d{1,20}$/.test(s) || s === "0") throw new ExchangeError("ids must be positive numbers");
    return BigInt(s);
  });
}

/** Public: host agent reports (alarms + advisor opinion) for up to 20 AgentDealsV2 deals. */
export async function getHostReports(db: Db, idsParam: string | null, deps: HostDeps): Promise<HostReport[]> {
  const ids = parseIds(idsParam);
  if (ids.length === 0) return [];
  const contract = contractAddr().toLowerCase();
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const { indexedTo, caughtUp } = await advanceIndex(db, deps.chain, contract);
  // Still behind after a long idle gap: keep catching up after the response is sent.
  if (!caughtUp) deps.schedule?.(async () => void (await advanceIndex(db, deps.chain, contract, MAX_CHUNKS_PER_CALL, 40_000)));
  const [chainDeals, usdt] = await Promise.all([deps.chain.deals(ids), deps.chain.usdt()]);
  const idStrs = ids.map(String);

  const [evidence, votes, opinions] = await Promise.all([
    db.query<{ deal_id: string; terms: string | null; delivery: string | null }>(
      `SELECT deal_id, terms, delivery FROM deal_evidence WHERE contract = $1 AND deal_id = ANY($2::text[])`,
      [contract, idStrs],
    ),
    db.query<{ deal_id: string; judge: string; revealed: boolean; pass: boolean | null }>(
      `SELECT deal_id, judge, revealed, pass FROM host_votes WHERE contract = $1 AND deal_id = ANY($2::text[])`,
      [contract, idStrs],
    ),
    db.query<OpinionRow>(`SELECT * FROM host_opinions WHERE contract = $1 AND deal_id = ANY($2::text[])`, [contract, idStrs]),
  ]);

  // Remember providers (for the repeat-ally signal across deals).
  for (const [i, d] of chainDeals.entries()) {
    if (d) {
      await db.query(`INSERT INTO host_deals (contract, deal_id, provider) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [contract, idStrs[i], d.provider.toLowerCase()]);
    }
  }

  // Fresh-wallet signal: refresh stale nonces for the judges involved (bounded).
  const judges = [...new Set(votes.map((v) => v.judge))];
  const known = judges.length
    ? await db.query<{ judge: string; nonce: string; checked_at: string | Date }>(`SELECT judge, nonce, checked_at FROM host_judges WHERE judge = ANY($1::text[])`, [judges])
    : [];
  const nonceOf = new Map(known.map((k) => [k.judge, { nonce: Number(k.nonce), at: new Date(k.checked_at).getTime() }]));
  const stale = judges.filter((j) => !nonceOf.has(j) || Date.now() - nonceOf.get(j)!.at > NONCE_TTL_MS).slice(0, 25);
  await Promise.all(
    stale.map(async (j) => {
      try {
        const n = await deps.chain.txCount(j as Address);
        nonceOf.set(j, { nonce: n, at: Date.now() });
        await db.query(
          `INSERT INTO host_judges (judge, nonce, checked_at) VALUES ($1, $2, now()) ON CONFLICT (judge) DO UPDATE SET nonce = EXCLUDED.nonce, checked_at = now()`,
          [j, n],
        );
      } catch {
        /* leave unknown */
      }
    }),
  );

  const reports: HostReport[] = [];
  for (const [i, d] of chainDeals.entries()) {
    const dealId = idStrs[i];
    const phase = phaseOf(d, now);
    const ev = evidence.find((e) => e.deal_id === dealId);
    const myVotes = votes.filter((v) => v.deal_id === dealId);

    // Repeat allies: PASS judges of this deal who also revealed PASS on other deals of the same provider.
    let allies = new Map<string, number>();
    if (d && myVotes.some((v) => v.revealed && v.pass)) {
      const rows = await db.query<{ judge: string; n: string }>(
        `SELECT v.judge, count(*) AS n FROM host_votes v JOIN host_deals h ON h.contract = v.contract AND h.deal_id = v.deal_id
          WHERE v.contract = $1 AND h.provider = $2 AND v.deal_id <> $3 AND v.revealed AND v.pass AND v.judge = ANY($4::text[])
          GROUP BY v.judge`,
        [contract, d.provider.toLowerCase(), dealId, myVotes.map((v) => v.judge)],
      );
      allies = new Map(rows.map((r) => [r.judge, Number(r.n)]));
    }
    const signals: JudgeSignal[] = myVotes.map((v) => ({
      revealed: v.revealed,
      pass: v.pass,
      nonce: nonceOf.get(v.judge)?.nonce ?? null,
      allyDeals: allies.get(v.judge) ?? 0,
    }));

    const op = opinions.find((o) => o.deal_id === dealId);
    const advisor = await advisorFor(db, deps, contract, dealId, d, phase, ev, op);
    const alarms = computeAlarms({
      phase,
      commits: d?.commits ?? 0,
      passVotes: d?.passVotes ?? 0,
      failVotes: d?.failVotes ?? 0,
      isUsdt: Boolean(d && d.token.toLowerCase() === usdt.toLowerCase()),
      amount: d?.amount ?? 0n,
      hasTerms: Boolean(ev?.terms),
      hasDelivery: Boolean(ev?.delivery),
      judges: signals,
      advisor: advisor.opinion ? { verdict: advisor.opinion.verdict, manipulation: advisor.opinion.manipulation } : null,
    });
    reports.push({ dealId, phase, alarms, advisor, indexedTo: indexedTo.toString() });
  }
  return reports;
}

async function advisorFor(
  db: Db,
  deps: HostDeps,
  contract: string,
  dealId: string,
  d: ChainDeal | null,
  phase: JuryFacts["phase"],
  ev: { terms: string | null; delivery: string | null } | undefined,
  op: OpinionRow | undefined,
): Promise<HostReport["advisor"]> {
  const shown = op && op.status === "done" ? toOpinion(op) : undefined;
  if (!advisorEnabled() && !deps.write) return shown ? { status: "done", opinion: shown } : { status: "disabled" };

  const eligible = Boolean(d && ev?.terms && ev?.delivery && (phase === "commit" || phase === "reveal"));
  if (!eligible) return shown ? { status: "done", opinion: shown } : { status: op ? (op.status as "failed") : "none" };

  const hash = inputHash(ev!.terms!, ev!.delivery!);
  const age = op ? Date.now() - new Date(op.created_at).getTime() : Infinity;
  const needs =
    !op ||
    (op.status === "done" && op.input_hash !== hash) ||
    (op.status === "pending" && age > PENDING_STALE_MS) ||
    ((op.status === "failed" || op.status === "refused") && age > FAILED_RETRY_MS);
  if (!needs) return { status: op!.status as "done", opinion: shown };

  // Daily cap: the advisor costs real API money.
  const today = await db.query<{ n: string }>(`SELECT count(*) AS n FROM host_opinions WHERE created_at > now() - interval '1 day'`);
  if (Number(today[0]?.n ?? 0) >= DAILY_OPINIONS) return shown ? { status: "done", opinion: shown } : { status: "none" };

  // Claim the job (only one request writes the opinion).
  const claimed = await db.query(
    `INSERT INTO host_opinions (contract, deal_id, status, input_hash, created_at) VALUES ($1, $2, 'pending', $3, now())
     ON CONFLICT (contract, deal_id) DO UPDATE SET status = 'pending', input_hash = EXCLUDED.input_hash, created_at = now()
       WHERE host_opinions.status <> 'pending' OR host_opinions.created_at < now() - interval '5 minutes'
     RETURNING deal_id`,
    [contract, dealId, hash],
  );
  if (claimed.length === 0) return { status: "pending", opinion: shown };

  const usdt = await deps.chain.usdt();
  const input: AdvisorInput = {
    dealId,
    token: d!.token.toLowerCase() === usdt.toLowerCase() ? "USDT" : "TWAK",
    amount: formatAmount(d!.amount),
    terms: ev!.terms!,
    delivery: ev!.delivery!,
  };
  const job = async () => {
    const write = deps.write ?? (await import("./hostAdvisor")).writeOpinion;
    const r = await write(input);
    if (r.status === "done") {
      const o = r.opinion;
      await db.query(
        `UPDATE host_opinions SET status = 'done', verdict = $3, confidence = $4, summary_en = $5, summary_zh = $6, reasons_en = $7::jsonb,
           reasons_zh = $8::jsonb, manipulation = $9, model = $10, created_at = now() WHERE contract = $1 AND deal_id = $2`,
        [contract, dealId, o.verdict, o.confidence, o.summary_en, o.summary_zh, JSON.stringify(o.reasons_en), JSON.stringify(o.reasons_zh), o.manipulation_detected, r.model],
      );
    } else {
      await db.query(`UPDATE host_opinions SET status = $3, created_at = now() WHERE contract = $1 AND deal_id = $2`, [contract, dealId, r.status]);
    }
  };
  (deps.schedule ?? ((j) => void j()))(() => job().catch(() => db.query(`UPDATE host_opinions SET status = 'failed' WHERE contract = $1 AND deal_id = $2`, [contract, dealId]).then(() => undefined)));
  return { status: "pending", opinion: shown };
}

function toOpinion(o: OpinionRow): HostOpinion {
  return {
    verdict: (o.verdict ?? "UNCLEAR") as HostOpinion["verdict"],
    confidence: (o.confidence ?? "low") as HostOpinion["confidence"],
    summary_en: o.summary_en ?? "",
    summary_zh: o.summary_zh ?? "",
    reasons_en: o.reasons_en ?? [],
    reasons_zh: o.reasons_zh ?? [],
    manipulation: Boolean(o.manipulation),
    model: o.model,
    createdAt: new Date(o.created_at).toISOString(),
  };
}

function formatAmount(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
