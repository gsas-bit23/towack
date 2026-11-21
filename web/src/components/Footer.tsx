import Link from "next/link";
import { CoinMark } from "./art";
import { NAV_LINKS } from "./NavLinks";
import { RiskNote } from "./RiskNote";

export function Footer() {
  return (
    <footer className="mt-auto bg-ice">
      <div className="mx-auto max-w-[1220px] px-6 pb-10 pt-20">
        <div className="grid grid-cols-12 items-start gap-10">
          <div className="col-span-12 md:col-span-4">
            <div className="flex items-center gap-3">
              <CoinMark size={60} />
              <span className="font-display text-[38px] font-extrabold">TOWACK</span>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2 font-extrabold">
              {NAV_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-candy">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
          <RiskNote className="col-span-12 md:col-span-8" />
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-2 border-t-2 border-navy/10 pt-6 text-sm font-bold text-navy/55">
          <span>© 2026 Towack. Arcade Sky. We never ask for keys, seed phrases, or pairing codes.</span>
          <span>TWAK · BSC</span>
        </div>
      </div>
    </footer>
  );
}
