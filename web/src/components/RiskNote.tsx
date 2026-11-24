"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

const DOCS_RISKS = "/docs#risks";

/** Site-wide footer line. The full risk text lives once, on /docs#risks. */
export function RiskNote({ className = "" }: { className?: string }) {
  const { rich } = useLocale();
  return (
    <p className={`text-[13px] leading-relaxed text-muted ${className}`}>
      {rich("risk.footer", {
        a: (c) => (
          <Link href={DOCS_RISKS} className="underline decoration-1 underline-offset-2 hover:text-fg">
            {c}
          </Link>
        ),
      })}
    </p>
  );
}

/**
 * The one risk line a trading page shows (Agent ID Hackathon rule: products involving trading display a risk
 * warning on the page). Put it once, under the page's main action.
 */
export function RiskLine({ className = "" }: { className?: string }) {
  const { rich } = useLocale();
  return (
    <p className={`text-center text-[12.5px] text-dim ${className}`}>
      {rich("risk.line", {
        a: (c) => (
          <Link href={DOCS_RISKS} className="underline decoration-1 underline-offset-2 hover:text-fg">
            {c}
          </Link>
        ),
      })}
    </p>
  );
}
