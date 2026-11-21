// Draw V1 prize deck. Mirrors TowackLaunch.prizeSlots / prizeBnb / prizeBonus (ids 0..10).
// One deck of 5,000 slots; each mint pops exactly one slot (mutually exclusive prizes).

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

const CANDY = "#FF4FA3";
const SKY = "#1FC6F2";
const SUN = "#FFCD2E";
const NAVY = "#13204A";
const WHITE = "#FFFFFF";
const ICE = "#BFEFFF";

export const PRIZES: readonly Prize[] = [
  { id: 0, label: "Full refund", wheel: "FULL", kind: "bnb", slots: 500, amount: "0.1 BNB back", jackpot: true, fill: SUN, ink: NAVY },
  { id: 1, label: "75% refund", wheel: "75%", kind: "bnb", slots: 600, amount: "0.075 BNB back", jackpot: false, fill: CANDY, ink: WHITE },
  { id: 2, label: "50% refund", wheel: "50%", kind: "bnb", slots: 800, amount: "0.05 BNB back", jackpot: false, fill: SKY, ink: NAVY },
  { id: 3, label: "25% refund", wheel: "25%", kind: "bnb", slots: 1600, amount: "0.025 BNB back", jackpot: false, fill: WHITE, ink: NAVY },
  { id: 4, label: "5× TWAK", wheel: "5×", kind: "bonus", slots: 20, amount: "+320,000 TWAK", jackpot: true, fill: NAVY, ink: SUN },
  { id: 5, label: "3× TWAK", wheel: "3×", kind: "bonus", slots: 40, amount: "+160,000 TWAK", jackpot: true, fill: CANDY, ink: WHITE },
  { id: 6, label: "2× TWAK", wheel: "2×", kind: "bonus", slots: 80, amount: "+80,000 TWAK", jackpot: false, fill: SUN, ink: NAVY },
  { id: 7, label: "1.5× TWAK", wheel: "1.5×", kind: "bonus", slots: 160, amount: "+40,000 TWAK", jackpot: false, fill: SKY, ink: NAVY },
  { id: 8, label: "1.25× TWAK", wheel: "1.25×", kind: "bonus", slots: 320, amount: "+20,000 TWAK", jackpot: false, fill: CANDY, ink: WHITE },
  { id: 9, label: "1.1× TWAK", wheel: "1.1×", kind: "bonus", slots: 400, amount: "+8,000 TWAK", jackpot: false, fill: SUN, ink: NAVY },
  { id: 10, label: "Better luck next time", wheel: "TRY AGAIN", kind: "none", slots: 480, amount: "no prize", jackpot: false, fill: ICE, ink: NAVY },
] as const;

export const DECK_SIZE = 5000;
export const NO_WIN_ID = 10;
export const DECK_BNB_TOTAL = "175 BNB";
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

export const SLICES: readonly Slice[] = (() => {
  const raw = WHEEL_ORDER.map((id) => (PRIZES[id].slots / DECK_SIZE) * 360);
  const small = raw.map((d) => d < MIN_DEG);
  const fixed = small.reduce((a, s) => a + (s ? MIN_DEG : 0), 0);
  const bigTotal = raw.reduce((a, d, i) => a + (small[i] ? 0 : d), 0);
  const scale = (360 - fixed) / bigTotal;
  let at = 0;
  return WHEEL_ORDER.map((id, i) => {
    const w = small[i] ? MIN_DEG : raw[i] * scale;
    const s = { id, start: at, end: at + w, mid: at + w / 2 };
    at += w;
    return s;
  });
})();

export function sliceOf(id: number): Slice {
  return SLICES.find((s) => s.id === id) ?? SLICES[0];
}

/** Deterministic in-slice jitter (−0.3..0.3 of half-width) so landings don't always hit dead centre. */
export function landingAngle(prizeId: number, salt: number): number {
  const s = sliceOf(prizeId);
  const half = (s.end - s.start) / 2;
  const h = Math.abs(Math.sin((salt + 1) * 12.9898 + prizeId * 78.233) * 43758.5453) % 1;
  return s.mid + (h - 0.5) * 0.6 * half;
}

export function shareText(prizeId: number): string {
  const p = PRIZES[prizeId];
  const pulled = p.kind === "none" ? "pulled “Better luck next time”" : `pulled ${p.label} (${p.amount})`;
  return `I spun the Towack prize wheel on BNB Chain and ${pulled} 🎡 Agent ID holders only. Game of chance, no promised returns.`;
}
