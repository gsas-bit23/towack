"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CoinMark } from "./art";
import { ConnectPill } from "./ConnectPill";
import { NetworkToggle } from "./NetworkToggle";
import { NAV_LINKS } from "./NavLinks";

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [open, setOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  // Close the menu on navigation (adjust state during render on prop change, per React docs).
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
  }

  // Escape closes; resizing up to the desktop row closes too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 1280px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 bg-ice/90 backdrop-blur-md">
      <nav
        className="mx-auto flex h-[68px] max-w-[1360px] items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6 xl:h-[80px]"
        aria-label="Main"
      >
        <Link href="/" className="flex min-h-10 shrink-0 items-center gap-2 sm:gap-2.5" aria-label="Towack home">
          <CoinMark size={46} className="h-10 w-10 shrink-0 xl:h-[44px] xl:w-[44px]" />
          {/* Wordmark: hidden on the narrowest phones; compact on xl desktops so all 10 nav links fit with 0 overflow. */}
          <span className="hidden font-display text-[22px] font-extrabold min-[375px]:inline sm:text-[26px] xl:text-[22px] 2xl:text-[26px]">TOWACK</span>
        </Link>
        <div className="hidden min-w-0 items-center gap-0.5 text-[14px] font-extrabold xl:flex 2xl:gap-1.5 2xl:text-[15px]">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`nav-pill flex min-h-10 items-center whitespace-nowrap px-1.5 hover:text-candy 2xl:px-2 ${isActive(l.href) ? "text-candy underline decoration-[3px] underline-offset-[6px]" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <NetworkToggle className="hidden md:flex" />
          <ConnectPill compact />
          <button
            type="button"
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-navy bg-white shadow-[0_4px_0_#13204A] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              {open ? (
                <path d="M5 5 L19 19 M19 5 L5 19" stroke="#13204A" strokeWidth="3.2" strokeLinecap="round" />
              ) : (
                <path d="M4 6 H20 M4 12 H20 M4 18 H20" stroke="#13204A" strokeWidth="3.2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open ? (
        <div id="mobile-menu" className="absolute inset-x-0 top-full border-y-4 border-navy bg-ice shadow-[0_10px_0_rgba(19,32,74,0.15)] xl:hidden">
          <div className="mx-auto max-h-[calc(100dvh-68px)] max-w-[1220px] overflow-y-auto px-4 py-4 sm:px-6">
            <ul className="grid gap-2 sm:grid-cols-2">
              {NAV_LINKS.map((l) => {
                const active = isActive(l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-12 items-center justify-between rounded-2xl border-[3px] border-navy px-4 font-display text-[18px] font-extrabold ${
                        active ? "bg-navy text-white" : "bg-white hover:bg-sun-pale"
                      }`}
                    >
                      {l.label}
                      <span aria-hidden="true" className={active ? "text-sun" : "text-candy"}>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 md:hidden">
              <span className="text-[13px] font-black uppercase tracking-widest text-navy/60">Network</span>
              <NetworkToggle className="flex" />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
