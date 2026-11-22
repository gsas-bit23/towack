// Draw V2 instant pool wheel. Mirrors DrawV2.multiplierBps / prizeSlots (ids 0..6, 10,000 slots).
// Separate from the paid Draw V1 deck (prizes.ts) and the Genesis deck (genesisPrizes.ts).
// Expected TWAK return Σ p × m = 0.95. The ~5% edge stays in the pool. Not a profit promise.

import { buildSlices, type Slice } from "./prizes";

export type PoolPrize = {
  id: number;
  label: string;
  wheel: string;
  multBps: number; // 10,000 = 1×
  slots: number; // of 10,000
  bnbBonusBps: number; // of the free BNB pot, top tiers only
  jackpot: boolean;
  fill: string;
  ink: string;
};

const CANDY = "#FF4FA3";
const SKY = "#1FC6F2";
const SUN = "#FFCD2E";
const NAVY = "#13204A";
const WHITE = "#FFFFFF";
const ICE = "#BFEFFF";

export const POOL_SLOTS = 10_000;
export const POOL_MIN_ENTRY = 100;
export const POOL_NO_WIN_ID = 0;
export const POOL_EV_PCT = 95;
export const POOL_MAX_PAYOUT_PCT = 5; // a 10× win <= 5% of the free pool
export const POOL_MAX_ENTRY_PCT = 0.5; // so max entry = 0.5% of the free pool
export const POOL_INTENDED_SEED = "70M TWAK";
export const POOL_TESTNET_SEED = "5M TWAK";

const tier = (id: number, wheel: string, multBps: number, slots: number, bnbBonusBps: number, fill: string, ink: string): PoolPrize => ({
  id,
  label: id === 6 ? "10× jackpot" : `${wheel} back`,
  wheel,
  multBps,
  slots,
  bnbBonusBps,
  jackpot: id >= 5,
  fill,
  ink,
});

export const POOL_PRIZES: readonly PoolPrize[] = [
  { ...tier(0, "0×", 0, 2_100, 0, ICE, NAVY), label: "0× — pool keeps it" },
  tier(1, "0.5×", 5_000, 3_200, 0, WHITE, NAVY),
  tier(2, "1×", 10_000, 2_200, 0, SKY, NAVY),
  tier(3, "1.5×", 15_000, 1_400, 0, CANDY, WHITE),
  tier(4, "2×", 20_000, 800, 0, SUN, NAVY),
  tier(5, "5×", 50_000, 200, 100, CANDY, WHITE),
  tier(6, "10×", 100_000, 100, 200, NAVY, SUN),
] as const;

/** Rim order spreads the two top tiers apart and alternates colours. */
export const POOL_WHEEL_ORDER = [6, 1, 4, 0, 5, 2, 3] as const;
export const POOL_SLICES: readonly Slice[] = buildSlices(POOL_WHEEL_ORDER, POOL_PRIZES, POOL_SLOTS);

export function poolPrizeById(id: number | undefined): PoolPrize | undefined {
  return id === undefined ? undefined : POOL_PRIZES[id];
}

export const oddsPct = (p: PoolPrize) => (p.slots / POOL_SLOTS) * 100;

/** TWAK paid for `entry` (wei) on prize `p` — same integer math as the contract. */
export function payoutFor(entry: bigint, p: PoolPrize): bigint {
  return (entry * BigInt(p.multBps)) / 10_000n;
}

/** Share of spins that return less than / exactly / more than the entry. */
export const POOL_SPLIT = {
  less: POOL_PRIZES.filter((p) => p.multBps < 10_000).reduce((a, p) => a + p.slots, 0) / 100,
  even: POOL_PRIZES.filter((p) => p.multBps === 10_000).reduce((a, p) => a + p.slots, 0) / 100,
  more: POOL_PRIZES.filter((p) => p.multBps > 10_000).reduce((a, p) => a + p.slots, 0) / 100,
};

export function poolShareText(prizeId: number): string {
  const p = POOL_PRIZES[prizeId];
  return `I spun the Towack pool wheel on BNB Chain and landed ${p.wheel} 🎡 Expected return is 95% — a game of chance, not an investment.`;
}
