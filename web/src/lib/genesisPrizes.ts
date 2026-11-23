// Genesis 300: a completely free, gas-only, flat 20,000 TWAK claim per Agent ID (TowackGenesis).
// No wheel, no Chainlink VRF, no bonus tiers and no second claim step: mint(agentTokenId) sends 20,000 TWAK
// in the same transaction. Mirrors TowackGenesis.MAX_MINTS / BASE_TOKENS / BUDGET.

export const GENESIS_BASE = 20_000;
export const GENESIS_CAP = 300;
export const GENESIS_BUDGET = "6M TWAK";
/** User-facing cost line (BSC gas for one claim at ~0.05–0.1 gwei is a fraction of a cent). */
export const GENESIS_COST_TEXT = "Completely free — only network gas (~$0.002), instant 20,000 TWAK";
// Localized copy for this (and the share text) lives in lib/i18n (genesis.cost / genesis.share) and lib/prizeText.ts.
