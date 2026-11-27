import type { MessageKey } from "@/lib/i18n";

// The paid mint closed with no mints (its 650M TWAK was burned), so the router, rebates, referrals and the Draw V1
// prize deck are gone from the site. Their old URLs redirect (next.config.ts).
export const NAV_LINKS: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/exchange", labelKey: "nav.exchange" },
  { href: "/mint", labelKey: "nav.genesis" },
  { href: "/lottery", labelKey: "nav.lottery" },
  { href: "/swap", labelKey: "nav.swap" },
  { href: "/perps", labelKey: "nav.perps" },
  { href: "/tokenomics", labelKey: "nav.tokenomics" },
  { href: "/docs", labelKey: "nav.docs" },
];

/** Desktop pill row shows the first PRIMARY_COUNT links; the rest live under "More" so the bar never overflows. */
export const PRIMARY_COUNT = 6;
