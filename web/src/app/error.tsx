"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto max-w-[720px] px-6 py-20">
      <Panel className="text-center">
        <div className="inline-block rounded-full border border-line bg-gold/10 px-4 py-1 text-xs font-semibold text-fg">SOMETHING BROKE</div>
        <h1 className="mt-4 font-display text-[36px] font-semibold leading-tight">Something went wrong.</h1>
        <p className="mt-2 font-medium text-sub">
          Nothing was sent or signed. Try reloading the page or return to the home stage.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button tone="soft" onClick={() => reset()}>
            Try again
          </Button>
          <Link
            href="/"
            className="press inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-card px-6 font-display text-[17px] font-semibold"
          >
            Back home
          </Link>
        </div>
      </Panel>
    </section>
  );
}
