// Pure (React-free) translation helpers, shared by the provider and unit tests.

import { MESSAGES } from "./dictionaries";

export type Locale = "en" | "zh";
export const LOCALES: readonly Locale[] = ["en", "zh"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "towack_locale";

export type MessageKey = keyof typeof MESSAGES;
export type Vars = Record<string, string | number>;

const IDX: Record<Locale, 0 | 1> = { en: 0, zh: 1 };

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "zh";
}

/** `{name}` placeholders; unknown placeholders are left as-is so a bad call is visible, never blank. */
export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Look up `key` in `locale`, falling back to English, then to the key itself (dynamic keys are cast to
 * MessageKey, so a typo there degrades to readable text instead of crashing).
 */
export function translate(locale: Locale, key: MessageKey | string, vars?: Vars): string {
  const pair = (MESSAGES as Record<string, readonly [string, string] | undefined>)[key];
  if (!pair) return interpolate(key, vars);
  const s = pair[IDX[locale]] || pair[0];
  return interpolate(s, vars);
}

export type TFn = (key: MessageKey, vars?: Vars) => string;

export function makeT(locale: Locale): TFn {
  return (key, vars) => translate(locale, key, vars);
}

export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}
