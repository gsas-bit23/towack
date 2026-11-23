import Link from "next/link";
import { CoinMark } from "./art";
import { NAV_LINKS } from "./NavLinks";
import { RiskNote } from "./RiskNote";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-bg">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-12 sm:px-8 sm:pt-14">
        <div className="grid grid-cols-12 items-start gap-x-0 gap-y-8 md:gap-x-10 [&>*]:min-w-0">
          <div className="col-span-12 md:col-span-4">
            <div className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]">
              <CoinMark size={28} />
              Towack
            </div>
            <nav aria-label="Footer" className="mt-5 grid grid-cols-2 gap-x-2 text-[14px]">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="flex min-h-10 items-center text-muted transition-colors hover:text-fg">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <RiskNote className="col-span-12 md:col-span-8" />
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-2 border-t border-line pt-6 text-[13px] text-dim">
          <span>© 2026 Towack. We never ask for keys, seed phrases, or pairing codes.</span>
          <span className="font-mono">TWAK · BSC</span>
        </div>
      </div>
    </footer>
  );
}
