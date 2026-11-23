export const NAV_LINKS = [
  { href: "/mint", label: "Mint" },
  { href: "/draw", label: "Draw" },
  { href: "/trade", label: "Trade" },
  { href: "/swap", label: "Swap" },
  { href: "/perps", label: "Perps" },
  { href: "/rebates", label: "Rebates" },
  { href: "/referrals", label: "Referrals" },
  { href: "/tokenomics", label: "Tokenomics" },
  { href: "/lottery", label: "Lottery" },
  { href: "/docs", label: "Docs" },
] as const;

/** Desktop pill row shows the first PRIMARY_COUNT links; the rest live under "More" so the bar never overflows. */
export const PRIMARY_COUNT = 6;
