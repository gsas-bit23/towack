"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CoinMark } from "./art";
import { ConnectPill } from "./ConnectPill";
import { NetworkToggle } from "./NetworkToggle";
import { NAV_LINKS } from "./NavLinks";

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-50 bg-ice/90 backdrop-blur-md">
      <nav className="mx-auto flex h-[80px] max-w-[1220px] items-center justify-between gap-4 px-6" aria-label="Main">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Towack home">
          <CoinMark size={46} />
          <span className="font-display text-[27px] font-extrabold">TOWACK</span>
        </Link>
        <div className="hidden items-center gap-5 text-[15px] font-extrabold xl:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`nav-pill hover:text-candy ${isActive(l.href) ? "text-candy underline decoration-[3px] underline-offset-[6px]" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <NetworkToggle />
          <ConnectPill />
        </div>
      </nav>
      <div className="border-t-2 border-navy/10 xl:hidden">
        <div className="mx-auto flex max-w-[1220px] gap-2 overflow-x-auto px-6 py-2 text-[14px] font-extrabold">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`nav-pill shrink-0 rounded-full px-3 py-1.5 ${isActive(l.href) ? "bg-navy text-white" : "hover:text-candy"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
