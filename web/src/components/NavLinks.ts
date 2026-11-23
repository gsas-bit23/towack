import type { MessageKey } from "@/lib/i18n";

export const NAV_LINKS: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/mint", labelKey: "nav.mint" },
  { href: "/draw", labelKey: "nav.draw" },
  { href: "/trade", labelKey: "nav.trade" },
  { href: "/swap", labelKey: "nav.swap" },
  { href: "/perps", labelKey: "nav.perps" },
  { href: "/rebates", labelKey: "nav.rebates" },
  { href: "/referrals", labelKey: "nav.referrals" },
  { href: "/tokenomics", labelKey: "nav.tokenomics" },
  { href: "/lottery", labelKey: "nav.lottery" },
  { href: "/docs", labelKey: "nav.docs" },
];

/** Desktop pill row shows the first PRIMARY_COUNT links; the rest live under "More" so the bar never overflows. */
export const PRIMARY_COUNT = 6;
