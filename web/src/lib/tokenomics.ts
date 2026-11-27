import type { MessageKey } from "@/lib/i18n";

// 1B TWAK split as minted (mirrors TowackToken constants; must sum to 100). The paid mint closed with zero mints, so
// TowackLaunch.closeMint() burned its whole allocation: the public mint, the initial-LP tokens and the Draw V1 bonus
// reserve (`burned: true`). 650M burned, 350M remain.
export const SPLIT = [
  { pct: 40, color: "#2A3352", label: "Public mint", note: "400M · burned", burned: true },
  { pct: 20, color: "#232B44", label: "Initial LP", note: "200M · burned", burned: true },
  { pct: 10, color: "#2FE3A0", label: "Trader rebates", note: "100M · 104 weeks", burned: false },
  { pct: 7, color: "#9BF0FF", label: "Draw V2 prizes", note: "70M · pool wheel seed", burned: false },
  { pct: 5, color: "#1E2540", label: "Draw V1 bonus reserve", note: "50M · burned", burned: true },
  { pct: 5, color: "#8B7CFF", label: "Team vesting", note: "1-yr cliff, 4-yr daily", burned: false },
  { pct: 5, color: "#C6F432", label: "Seasons & referrals", note: "50M", burned: false },
  { pct: 5, color: "#DBFF6E", label: "Ecosystem / dev", note: "50M", burned: false },
  { pct: 3, color: "#B0B8CC", label: "POL buffer", note: "30M", burned: false },
] as const;

export const SPLIT_TOTAL = SPLIT.reduce((a, s) => a + s.pct, 0);
/** Share of the original 1B burned at the launch close, and what remains (percent of 1B). */
export const BURNED_PCT = SPLIT.filter((s) => s.burned).reduce((a, s) => a + s.pct, 0);
export const REMAINING_PCT = SPLIT_TOTAL - BURNED_PCT;
export const TOTAL_MINTED = 1_000_000_000;

/** Localized bucket label / note by SPLIT index (tok.split.<i> / tok.split.<i>n). */
export const splitKey = (i: number, note = false) => `tok.split.${i}${note ? "n" : ""}` as MessageKey;
