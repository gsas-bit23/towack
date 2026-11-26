/**
 * Agent Exchange schema (Postgres). Every statement is idempotent.
 *
 * Privacy: `agents.wallet` is stored only so the server can match sign-ins and on-chain deals; the API never
 * returns it (Agent ID Hackathon rule: Agent ID must not become a tool for looking up wallets by name).
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS agents (
    agent_id    TEXT PRIMARY KEY,               -- Agent ID token id (decimal uint256) = keccak256(handle)
    handle      TEXT NOT NULL UNIQUE,           -- without ".ai"
    wallet      TEXT NOT NULL UNIQUE,           -- lowercase 0x address; never exposed by the API
    bio         TEXT NOT NULL DEFAULT '',
    services    JSONB NOT NULL DEFAULT '[]',    -- [{ title, description, priceUsdt? }]
    listed      BOOLEAN NOT NULL DEFAULT FALSE, -- opt-in to the public directory
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce       TEXT PRIMARY KEY,
    wallet      TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,               -- sha256 of the bearer token; the token itself is never stored
    agent_id    TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id          BIGSERIAL PRIMARY KEY,
    from_agent  TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    to_agent    TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'text',   -- text | offer
    body        TEXT NOT NULL,
    deal_id     TEXT,                           -- AgentDeals deal id for kind = offer
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS messages_to_idx ON messages (to_agent, id DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (from_agent, to_agent, id DESC)`,
  // Public judge evidence for AgentDealsV2: texts are stored only if their keccak256 matches the on-chain hash.
  `CREATE TABLE IF NOT EXISTS deal_evidence (
    contract    TEXT NOT NULL,                  -- lowercase AgentDealsV2 address
    deal_id     TEXT NOT NULL,
    terms       TEXT,
    delivery    TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contract, deal_id)
  )`,
  // Host agent (advisor + alarm). It never signs or moves funds; these tables only cache public chain data and its
  // own written opinions. Judge addresses are public on-chain; the API returns counts, never addresses.
  `CREATE TABLE IF NOT EXISTS host_index (
    contract    TEXT PRIMARY KEY,               -- lowercase AgentDealsV2 address
    last_block  BIGINT NOT NULL,                -- vote events are indexed up to and including this block
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS host_votes (
    contract    TEXT NOT NULL,
    deal_id     TEXT NOT NULL,
    judge       TEXT NOT NULL,                  -- lowercase judge wallet (public VoteCommitted / VoteRevealed data)
    committed   BOOLEAN NOT NULL DEFAULT FALSE,
    revealed    BOOLEAN NOT NULL DEFAULT FALSE,
    pass        BOOLEAN,                        -- set on reveal
    PRIMARY KEY (contract, deal_id, judge)
  )`,
  `CREATE INDEX IF NOT EXISTS host_votes_judge_idx ON host_votes (contract, judge)`,
  `CREATE TABLE IF NOT EXISTS host_deals (
    contract    TEXT NOT NULL,
    deal_id     TEXT NOT NULL,
    provider    TEXT NOT NULL,                  -- lowercase; used only to spot repeat "ally" judges
    PRIMARY KEY (contract, deal_id)
  )`,
  `CREATE TABLE IF NOT EXISTS host_judges (
    judge       TEXT PRIMARY KEY,               -- lowercase wallet
    nonce       BIGINT NOT NULL,                -- outgoing tx count when checked (fresh-wallet signal)
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS host_opinions (
    contract       TEXT NOT NULL,
    deal_id        TEXT NOT NULL,
    status         TEXT NOT NULL,               -- pending | done | failed | refused
    verdict        TEXT,                        -- PASS | FAIL | UNCLEAR
    confidence     TEXT,                        -- low | medium | high
    summary_en     TEXT,
    summary_zh     TEXT,
    reasons_en     JSONB,
    reasons_zh     JSONB,
    manipulation   BOOLEAN,
    model          TEXT,
    input_hash     TEXT,                        -- keccak of terms + delivery the opinion was written for
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contract, deal_id)
  )`,
  // Optional link to the agent's ERC-8004 identity (BNB Chain's agent registry), verified on-chain when linked.
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_id TEXT`,
];
