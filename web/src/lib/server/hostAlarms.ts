// Host agent ALARM: deterministic red flags for an AgentDealsV2 jury, computed from public chain data. Pure functions
// (no I/O) so every rule is unit-tested. The host agent can only warn: it has no key and no power over any deal.

export type AlarmLevel = "info" | "warn" | "alert";
export type AlarmCode =
  | "LOW_TURNOUT" // fewer than QUORUM sealed votes while voting is open
  | "WILL_PASS_BY_DEFAULT" // revealing / ready with fewer than QUORUM revealed votes: the deal passes whatever they say
  | "UNREVEALED" // sealed votes that were never revealed (they don't count)
  | "FRESH_JUDGES" // judges whose wallets have almost no history
  | "REPEAT_ALLIES" // PASS judges who also voted PASS on several other deals of the same provider
  | "SPLIT_VOTE" // revealed FAIL share is between 1/2 and 2/3: a near miss either way
  | "BIG_DEAL_THIN_JURY" // a large USDT deal judged by a small jury
  | "NO_TERMS_TEXT" // judges can't see the agreed terms
  | "NO_DELIVERY_TEXT" // judges can't see the delivery
  | "ADVISOR_DISAGREES" // the advisor's opinion is opposite to the revealed majority
  | "MANIPULATION_ATTEMPT"; // the advisor found instructions aimed at judges/AI inside the evidence

export type Alarm = { code: AlarmCode; level: AlarmLevel; n?: number };

export const QUORUM = 3;
export const FRESH_NONCE = 5; // a wallet with fewer outgoing transactions than this counts as fresh
export const ALLY_MIN_DEALS = 2; // PASS on at least this many OTHER deals of the same provider
export const BIG_USDT = 500n * 10n ** 18n;
export const THIN_JURY = 5;

export type JudgeSignal = {
  revealed: boolean;
  pass: boolean | null;
  nonce: number | null; // null = not checked yet
  allyDeals: number; // other deals of this provider where this judge revealed PASS
};

export type JuryFacts = {
  phase: "commit" | "reveal" | "finalize" | "settled" | "none";
  commits: number;
  passVotes: number;
  failVotes: number;
  isUsdt: boolean;
  amount: bigint;
  hasTerms: boolean;
  hasDelivery: boolean;
  judges: JudgeSignal[];
  advisor?: { verdict: "PASS" | "FAIL" | "UNCLEAR"; manipulation: boolean } | null;
};

const failShare = (p: number, f: number) => (p + f === 0 ? 0 : f / (p + f));

export function computeAlarms(f: JuryFacts): Alarm[] {
  const out: Alarm[] = [];
  const live = f.phase === "commit" || f.phase === "reveal" || f.phase === "finalize";
  const revealed = f.passVotes + f.failVotes;

  if (f.phase !== "none") {
    if (!f.hasTerms) out.push({ code: "NO_TERMS_TEXT", level: "warn" });
    if (!f.hasDelivery) out.push({ code: "NO_DELIVERY_TEXT", level: live ? "alert" : "warn" });
  }
  if (f.phase === "commit" && f.commits < QUORUM) out.push({ code: "LOW_TURNOUT", level: "warn", n: f.commits });
  if ((f.phase === "reveal" || f.phase === "finalize") && revealed < QUORUM) {
    out.push({ code: "WILL_PASS_BY_DEFAULT", level: "warn", n: revealed });
  }
  if ((f.phase === "reveal" || f.phase === "finalize" || f.phase === "settled") && f.commits > revealed) {
    out.push({ code: "UNREVEALED", level: f.phase === "reveal" ? "info" : "warn", n: f.commits - revealed });
  }

  const checked = f.judges.filter((j) => j.nonce !== null);
  const fresh = checked.filter((j) => (j.nonce as number) < FRESH_NONCE).length;
  if (fresh >= 2 || (checked.length > 0 && fresh * 2 >= checked.length && fresh > 0)) {
    out.push({ code: "FRESH_JUDGES", level: fresh * 2 >= Math.max(1, f.judges.length) ? "alert" : "warn", n: fresh });
  }

  const allies = f.judges.filter((j) => j.revealed && j.pass === true && j.allyDeals >= ALLY_MIN_DEALS).length;
  if (allies > 0) out.push({ code: "REPEAT_ALLIES", level: allies >= 2 ? "alert" : "warn", n: allies });

  const share = failShare(f.passVotes, f.failVotes);
  if (revealed >= QUORUM && share >= 0.5 && share < 2 / 3) out.push({ code: "SPLIT_VOTE", level: "info" });

  if (f.isUsdt && f.amount >= BIG_USDT && live && f.commits < THIN_JURY) {
    out.push({ code: "BIG_DEAL_THIN_JURY", level: "alert", n: f.commits });
  }

  if (f.advisor) {
    if (f.advisor.manipulation) out.push({ code: "MANIPULATION_ATTEMPT", level: "alert" });
    if (revealed >= QUORUM && f.advisor.verdict !== "UNCLEAR") {
      const majorityFail = share >= 2 / 3;
      if ((f.advisor.verdict === "FAIL") !== majorityFail) out.push({ code: "ADVISOR_DISAGREES", level: "info" });
    }
  }

  const rank: Record<AlarmLevel, number> = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
