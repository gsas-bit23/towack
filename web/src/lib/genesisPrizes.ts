// Genesis 300 wheel. Mirrors TowackGenesis.prizeSlots / prizeExtra (ids 0..6). Separate from the paid
// Draw V1 deck in prizes.ts: different ids, TWAK only, no BNB refunds.
// Base 20,000 TWAK per free mint; a k× slot pays (k − 1) × 20,000 extra on top.

import { buildSlices, type Slice } from "./prizes";

export type GenesisPrize = {
  id: number;
  label: string;
  wheel: string;
  kind: "bonus" | "none";
  slots: number; // in the 300-slot deck
  extra: number; // TWAK on top of the 20k base
  total: number; // base + extra
  amount: string;
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

export const GENESIS_BASE = 20_000;
export const GENESIS_CAP = 300;
export const GENESIS_BUDGET = "8M TWAK";
export const GENESIS_NO_BONUS_ID = 6;

const tier = (id: number, mult: string, slots: number, extra: number, jackpot: boolean, fill: string, ink: string): GenesisPrize => ({
  id,
  label: `${mult} Genesis`,
  wheel: mult,
  kind: "bonus",
  slots,
  extra,
  total: GENESIS_BASE + extra,
  amount: `+${extra.toLocaleString("en-US")} TWAK`,
  jackpot,
  fill,
  ink,
});

export const GENESIS_PRIZES: readonly GenesisPrize[] = [
  tier(0, "5×", 5, 80_000, true, NAVY, SUN),
  tier(1, "3×", 10, 40_000, true, CANDY, WHITE),
  tier(2, "2×", 20, 20_000, false, SUN, NAVY),
  tier(3, "1.5×", 40, 10_000, false, SKY, NAVY),
  tier(4, "1.25×", 50, 5_000, false, CANDY, WHITE),
  tier(5, "1.1×", 75, 2_000, false, WHITE, NAVY),
  { id: 6, label: "No bonus", wheel: "BASE", kind: "none", slots: 100, extra: 0, total: GENESIS_BASE, amount: "base only", jackpot: false, fill: ICE, ink: NAVY },
] as const;

export const GENESIS_WHEEL_ORDER = [0, 3, 1, 5, 6, 4, 2] as const;
export const GENESIS_SLICES: readonly Slice[] = buildSlices(GENESIS_WHEEL_ORDER, GENESIS_PRIZES, GENESIS_CAP);

export function genesisPrizeById(id: number | undefined): GenesisPrize | undefined {
  return id === undefined ? undefined : GENESIS_PRIZES[id];
}

export function genesisShareText(prizeId: number): string {
  const p = GENESIS_PRIZES[prizeId];
  const pulled = p.kind === "none" ? "got the 20,000 TWAK base" : `pulled ${p.wheel} (${p.total.toLocaleString("en-US")} TWAK total)`;
  return `I claimed a free Towack Genesis 300 spot on BNB Chain and ${pulled} 🎡 Agent ID holders only. Game of chance, no promised returns.`;
}
