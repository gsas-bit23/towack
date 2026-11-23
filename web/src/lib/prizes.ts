// Draw V1 prize deck. Mirrors TowackLaunch.prizeSlots / prizeBnb / prizeBonus (ids 0..10).
// One deck of 5,000 slots; each mint pops exactly one slot (mutually exclusive prizes).
// BNB tiers are 100/75/50/25% of the 0.095 BNB residual (0.1 mint price minus the 0.005 referral set-aside).

export type PrizeKind = "bnb" | "bonus" | "none";

export type Prize = {
  id: number;
  label: string; // full name ("Full refund", "5× bonus", ...)
  wheel: string; // short text on the wheel
  kind: PrizeKind;
  slots: number; // in the full 5,000-slot deck
  amount: string; // human amount
  jackpot: boolean;
  fill: string; // wheel slice colour
  ink: string; // text colour on the slice
};

const SLATE = "#2B3139"; // Atlas slate
const STEEL = "#3A414B"; // Atlas steel
const GOLD = "#F0B90B"; // Atlas gold
const CARD2 = "#1D2229"; // Atlas card-2
const CARD = "#161A20"; // Atlas card
const TEXT = "#EAECEF";
const ON_GOLD = "#181A20";
const MUTED = "#8B94A3";
const GOLD_DIM = "#4A3C10"; // muted gold slab for mid tiers
const GOLD_INK = "#FCD535";

export const PRIZES: readonly Prize[] = [
  { id: 0, label: "Full refund", wheel: "FULL", kind: "bnb", slots: 500, amount: "0.095 BNB back", jackpot: true, fill: GOLD, ink: ON_GOLD },
  { id: 1, label: "75% refund", wheel: "75%", kind: "bnb", slots: 600, amount: "0.07125 BNB back", jackpot: false, fill: SLATE, ink: TEXT },
  { id: 2, label: "50% refund", wheel: "50%", kind: "bnb", slots: 800, amount: "0.0475 BNB back", jackpot: false, fill: STEEL, ink: TEXT },
  { id: 3, label: "25% refund", wheel: "25%", kind: "bnb", slots: 1600, amount: "0.02375 BNB back", jackpot: false, fill: CARD2, ink: TEXT },
  { id: 4, label: "5× TWAK", wheel: "5×", kind: "bonus", slots: 20, amount: "+320,000 TWAK", jackpot: true, fill: GOLD, ink: ON_GOLD },
  { id: 5, label: "3× TWAK", wheel: "3×", kind: "bonus", slots: 40, amount: "+160,000 TWAK", jackpot: true, fill: SLATE, ink: TEXT },
  { id: 6, label: "2× TWAK", wheel: "2×", kind: "bonus", slots: 80, amount: "+80,000 TWAK", jackpot: false, fill: GOLD_DIM, ink: GOLD_INK },
  { id: 7, label: "1.5× TWAK", wheel: "1.5×", kind: "bonus", slots: 160, amount: "+40,000 TWAK", jackpot: false, fill: STEEL, ink: TEXT },
  { id: 8, label: "1.25× TWAK", wheel: "1.25×", kind: "bonus", slots: 320, amount: "+20,000 TWAK", jackpot: false, fill: SLATE, ink: TEXT },
  { id: 9, label: "1.1× TWAK", wheel: "1.1×", kind: "bonus", slots: 400, amount: "+8,000 TWAK", jackpot: false, fill: GOLD_DIM, ink: GOLD_INK },
  { id: 10, label: "Better luck next time", wheel: "TRY AGAIN", kind: "none", slots: 480, amount: "no prize", jackpot: false, fill: CARD, ink: MUTED },
] as const;

export const DECK_SIZE = 5000;
export const NO_WIN_ID = 10;
export const DECK_BNB_TOTAL = "166.25 BNB";
/** BNB a referrer earns per referred paid mint (TowackLaunch.REFERRAL_FEE). */
export const REFERRAL_FEE_BNB = "0.005 BNB";
export const DECK_BONUS_TOTAL = "35.2M TWAK";

export function prizeById(id: number | undefined): Prize | undefined {
  return id === undefined ? undefined : PRIZES[id];
}

/**
 * Wheel layout. Order around the rim spreads jackpots and alternates colours. Slices are sized by true
 * odds (slots / 5,000) with a minimum width so the rare 5× / 3× slices stay readable; the legend always
 * shows the real odds.
 */
export const WHEEL_ORDER = [0, 4, 3, 7, 1, 5, 10, 8, 2, 6, 9] as const;
const MIN_DEG = 13;

export type Slice = { id: number; start: number; end: number; mid: number };

/** Odds-sized slices in rim order, with a minimum width for rare tiers. Shared by the paid and Genesis wheels. */
export function buildSlices(order: readonly number[], prizes: readonly { slots: number }[], deckSize: number, minDeg = MIN_DEG): Slice[] {
  const raw = order.map((id) => (prizes[id].slots / deckSize) * 360);
  const small = raw.map((d) => d < minDeg);
  const fixed = small.reduce((a, s) => a + (s ? minDeg : 0), 0);
  const bigTotal = raw.reduce((a, d, i) => a + (small[i] ? 0 : d), 0);
  const scale = (360 - fixed) / bigTotal;
  let at = 0;
  return order.map((id, i) => {
    const w = small[i] ? minDeg : raw[i] * scale;
    const s = { id, start: at, end: at + w, mid: at + w / 2 };
    at += w;
    return s;
  });
}

export const SLICES: readonly Slice[] = buildSlices(WHEEL_ORDER, PRIZES, DECK_SIZE);

export function sliceIn(slices: readonly Slice[], id: number): Slice {
  return slices.find((s) => s.id === id) ?? slices[0];
}

export function sliceOf(id: number): Slice {
  return sliceIn(SLICES, id);
}

/** Deterministic in-slice jitter (−0.3..0.3 of half-width) so landings don't always hit dead centre. */
export function landingAngleIn(slices: readonly Slice[], prizeId: number, salt: number): number {
  const s = sliceIn(slices, prizeId);
  const half = (s.end - s.start) / 2;
  const h = Math.abs(Math.sin((salt + 1) * 12.9898 + prizeId * 78.233) * 43758.5453) % 1;
  return s.mid + (h - 0.5) * 0.6 * half;
}

export function landingAngle(prizeId: number, salt: number): number {
  return landingAngleIn(SLICES, prizeId, salt);
}

export function shareText(prizeId: number): string {
  const p = PRIZES[prizeId];
  const pulled = p.kind === "none" ? "pulled “Better luck next time”" : `pulled ${p.label} (${p.amount})`;
  return `I spun the Towack prize wheel on BNB Chain and ${pulled} 🎡 Agent ID holders only. Game of chance, no promised returns.`;
}
