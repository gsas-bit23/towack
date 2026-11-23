"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CoinMark } from "./art";
import { ConnectPill } from "./ConnectPill";
import { NetworkToggle } from "./NetworkToggle";
import { NAV_LINKS, PRIMARY_COUNT } from "./NavLinks";

const PRIMARY = NAV_LINKS.slice(0, PRIMARY_COUNT);
const MORE = NAV_LINKS.slice(PRIMARY_COUNT);

const PILL = "nav-pill relative flex h-9 items-center whitespace-nowrap rounded-full px-3 text-[14px] font-medium";

export function Nav() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close menus on navigation (adjust state during render on prop change, per React docs).
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
    setMoreOpen(false);
  }

  // Escape closes; resizing up to the desktop row closes the mobile sheet.
  useEffect(() => {
    if (!open && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMoreOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const mq = window.matchMedia("(min-width: 1280px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      mq.removeEventListener("change", onMq);
    };
  }, [open, moreOpen]);

  const moreActive = MORE.some((l) => isActive(l.href));
  const sheet = reduce ? { initial: false as const } : { initial: { opacity: 0, y: -6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[rgba(11,14,17,.86)] backdrop-blur-[12px]">
      <nav className="mx-auto flex h-[58px] max-w-[1280px] items-center gap-3 px-4 sm:px-6 xl:h-16 xl:gap-8 xl:px-8" aria-label="Main">
        <Link href="/" className="flex min-h-10 shrink-0 items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]" aria-label="Towack home">
          <CoinMark size={28} />
          <span className="hidden min-[360px]:inline">Towack</span>
        </Link>

        <div className="hidden min-w-0 items-center gap-1 xl:flex">
          {PRIMARY.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`${PILL} ${active ? "text-fg" : "text-muted hover:bg-card hover:text-fg"}`}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-card-2"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                {l.label}
              </Link>
            );
          })}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              aria-controls="nav-more"
              onClick={() => setMoreOpen((o) => !o)}
              className={`${PILL} gap-1 ${moreActive || moreOpen ? "bg-card-2 text-fg" : "text-muted hover:bg-card hover:text-fg"}`}
            >
              More
              <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden="true">
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <AnimatePresence>
              {moreOpen ? (
                <motion.div
                  id="nav-more"
                  {...sheet}
                  transition={{ duration: 0.16 }}
                  className="absolute left-0 top-[calc(100%+8px)] w-52 rounded-xl border border-line-2 bg-card p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)]"
                >
                  {MORE.map((l) => {
                    const active = isActive(l.href);
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex h-10 items-center justify-between rounded-lg px-3 text-[14px] font-medium ${
                          active ? "bg-card-2 text-fg" : "text-sub hover:bg-card-2 hover:text-fg"
                        }`}
                      >
                        {l.label}
                        {active ? <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" /> : null}
                      </Link>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
          <NetworkToggle className="hidden md:flex" />
          <ConnectPill compact />
          <button
            type="button"
            className="press grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-line-2 text-fg hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              {open ? (
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="mobile-menu"
            {...sheet}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 top-full border-b border-line bg-bg xl:hidden"
          >
            <div className="mx-auto max-h-[calc(100dvh-58px)] max-w-[1200px] overflow-y-auto px-4 py-4 sm:px-6">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {NAV_LINKS.map((l) => {
                  const active = isActive(l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={`flex min-h-12 items-center justify-between rounded-xl border px-4 text-[15px] font-medium ${
                          active ? "border-line-2 bg-card-2 text-fg" : "border-line bg-card text-sub hover:text-fg"
                        }`}
                      >
                        {l.label}
                        <span aria-hidden="true" className={active ? "text-gold" : "text-dim"}>
                          →
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 md:hidden">
                <span className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">Network</span>
                <NetworkToggle className="flex" />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
