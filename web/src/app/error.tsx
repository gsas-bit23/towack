"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto max-w-[720px] px-6 py-20">
      <Panel className="text-center">
        <div className="inline-block rounded-full border-[3px] border-navy bg-candy px-4 py-1 text-xs font-black text-white">SOMETHING BROKE</div>
        <h1 className="mt-4 font-display text-[36px] font-extrabold leading-tight">This booth hit a snag.</h1>
        <p className="mt-2 font-bold text-navy/75">
          Nothing was sent or signed. Try reloading the page or return to the home stage.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button tone="sun" onClick={() => reset()}>
            Try again
          </Button>
          <Link
            href="/"
            className="press inline-flex min-h-12 items-center justify-center rounded-full border-4 border-navy bg-white px-6 font-display text-[17px] font-extrabold shadow-[0_6px_0_#13204A]"
          >
            Back home
          </Link>
        </div>
      </Panel>
    </section>
  );
}
