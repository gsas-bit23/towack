import type { MessageKey } from "@/lib/i18n";

// 1B TWAK split. Mirrors TowackToken constants; must sum to 100.
export const SPLIT = [
  { pct: 40, color: "#C6F432", label: "Public mint", note: "400M · 80k per mint" },
  { pct: 20, color: "#8B7CFF", label: "Initial LP", note: "200M · at mint price" },
  { pct: 10, color: "#2FE3A0", label: "Trader rebates", note: "100M · 104 weeks" },
  { pct: 7, color: "#9BF0FF", label: "Draw V2 prizes", note: "70M · pool wheel seed" },
  { pct: 5, color: "#5A4FB8", label: "Draw V1 bonus reserve", note: "50M · unused burned" },
  { pct: 5, color: "#B0B8CC", label: "Team vesting", note: "1-yr cliff, 4-yr daily" },
  { pct: 5, color: "#7F89A3", label: "Seasons & referrals", note: "50M" },
  { pct: 5, color: "#5B6582", label: "Ecosystem / dev", note: "50M" },
  { pct: 3, color: "#34406A", label: "POL buffer", note: "30M" },
] as const;

export const SPLIT_TOTAL = SPLIT.reduce((a, s) => a + s.pct, 0);

/** Localized bucket label / note by SPLIT index (tok.split.<i> / tok.split.<i>n). */
export const splitKey = (i: number, note = false) => `tok.split.${i}${note ? "n" : ""}` as MessageKey;
