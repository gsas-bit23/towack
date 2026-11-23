"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { renderRich, type RichTags } from "./rich";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  htmlLang,
  isLocale,
  translate,
  type Locale,
  type MessageKey,
  type TFn,
  type Vars,
} from "./translate";

// The locale lives in localStorage and is read through useSyncExternalStore: the server snapshot (and therefore
// SSR + the hydration render) is always "en", and React re-renders with the stored choice right after hydration.
// No hydration mismatch, no flash of the wrong tree during hydration.

const EVENT = "towack-locale";
let memory: Locale | null = null; // fallback when storage is blocked (private mode)

function readStored(): Locale | null {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(v)) return v;
  } catch {
    /* storage blocked */
  }
  return memory;
}

function writeStored(l: Locale) {
  memory = l;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
  } catch {
    /* storage blocked: memory copy still applies for this tab */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LOCALE_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

const getSnapshot = (): Locale => readStored() ?? DEFAULT_LOCALE;
const getServerSnapshot = (): Locale => DEFAULT_LOCALE;

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
  /** Translate and render `<b>…</b>`-style tags with the given renderers. */
  rich: (key: MessageKey, tags?: RichTags, vars?: Vars) => ReactNode;
};

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // First visit with no saved choice: follow a Chinese browser language once, and remember it.
  useEffect(() => {
    if (readStored()) return;
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (langs[0]?.toLowerCase().startsWith("zh")) writeStored("zh");
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => writeStored(l), []);
  const value = useMemo<Ctx>(() => {
    const t: TFn = (key, vars) => translate(locale, key, vars);
    return { locale, setLocale, t, rich: (key, tags, vars) => renderRich(t(key, vars), tags) };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const FALLBACK: Ctx = {
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  rich: (key, tags, vars) => renderRich(translate(DEFAULT_LOCALE, key, vars), tags),
};

export function useLocale(): Ctx {
  return useContext(LocaleContext) ?? FALLBACK;
}

/** Translated text for server components: `<T k="mint.title" />`. `tags` must be serializable specs here. */
export function T({ k, vars, tags }: { k: MessageKey; vars?: Vars; tags?: RichTags }) {
  const { t } = useLocale();
  const s = t(k, vars);
  return <>{tags ? renderRich(s, tags) : s}</>;
}
