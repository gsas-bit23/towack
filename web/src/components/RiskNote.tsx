"use client";

import { useLocale } from "@/lib/i18n";

export function RiskNote({ className = "" }: { className?: string }) {
  const { t } = useLocale();
  return (
    <div className={`rounded-2xl border border-line bg-card p-6 ${className}`}>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.12em] text-gold">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {t("risk.title")}
      </div>
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t("risk.base")} {t("risk.verify")}
      </p>
    </div>
  );
}
