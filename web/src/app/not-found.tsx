import Link from "next/link";
import { Panel } from "@/components/ui";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-[720px] px-6 py-20">
      <Panel tone="sunPale" className="text-center">
        <div className="inline-block rounded-full border-[3px] border-navy bg-navy px-4 py-1 text-xs font-black text-sun">404</div>
        <h1 className="mt-4 font-display text-[40px] font-extrabold leading-tight">No booth at this address.</h1>
        <p className="mt-2 font-bold text-navy/75">That page does not exist. Head back to the main Arcade Sky stage.</p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="press inline-flex min-h-12 items-center justify-center rounded-full border-4 border-navy bg-candy px-7 font-display text-[18px] font-extrabold text-white shadow-[0_6px_0_#13204A]"
          >
            Back to Towack
          </Link>
        </div>
      </Panel>
    </section>
  );
}
