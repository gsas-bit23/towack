"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { CoinMark } from "./art";
import { NAV_LINKS } from "./NavLinks";
import { RiskNote } from "./RiskNote";

const X_URL = "https://x.com/towackxyz";

function XMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.726-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-auto border-t border-line bg-bg">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-12 sm:px-8 sm:pt-14">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]">
            <CoinMark size={28} />
            Towack
          </div>
          <nav aria-label={t("footer.nav")} className="flex flex-wrap gap-x-5 text-[14px]">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="flex min-h-10 items-center text-muted transition-colors hover:text-fg">
                {t(l.labelKey)}
              </Link>
            ))}
          </nav>
        </div>
        <RiskNote className="mt-6 max-w-[760px]" />
        <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-6 text-[13px] text-dim">
          <span>{t("footer.copyright")}</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 font-medium text-muted transition-colors hover:text-fg"
              aria-label={t("footer.xAria")}
            >
              <XMark />
              @towackxyz
            </a>
            <span className="font-mono">TWAK · BSC</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
