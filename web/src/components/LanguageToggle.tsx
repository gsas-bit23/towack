"use client";

import { LOCALES, useLocale, type Locale } from "@/lib/i18n";

const LABEL: Record<Locale, "lang.en" | "lang.zh"> = { en: "lang.en", zh: "lang.zh" };
const SWITCH: Record<Locale, "lang.switchToEn" | "lang.switchToZh"> = { en: "lang.switchToEn", zh: "lang.switchToZh" };

/** EN / 中文 segmented pill. `size="sm"` is the compact header variant for phones. */
export function LanguageToggle({ className = "", size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const { locale, setLocale, t } = useLocale();
  const h = size === "sm" ? "h-8 text-[12px]" : "h-9 text-[13px]";
  const seg = size === "sm" ? "px-2" : "px-2.5";
  return (
    <div role="group" aria-label={t("lang.label")} className={`items-center gap-0.5 rounded-full border border-line-2 p-0.5 ${h} ${className}`}>
      {LOCALES.map((l) => {
        const on = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l === "zh" ? "zh-CN" : "en"}
            aria-pressed={on}
            title={t(SWITCH[l])}
            onClick={() => setLocale(l)}
            className={`grid h-full min-w-[30px] place-items-center rounded-full font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${seg} ${
              on ? "bg-card-2 text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {t(LABEL[l])}
          </button>
        );
      })}
    </div>
  );
}
