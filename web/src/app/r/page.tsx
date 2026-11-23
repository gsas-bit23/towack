import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { RefLanding } from "./RefLanding";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "You're invited" };

// Friend landing for /r/<handle>?ref=<address>. next.config.ts rewrites /r/:handle here (the browser URL keeps the
// handle), so this is one static page; the handle and `ref` are read client-side from the URL. There is no on-chain
// SPACE ID resolver: `ref` is the referrer.
export default function RefPage() {
  return (
    <>
      <PageHeader kicker={<T k="r.kicker" />} title={<T k="r.title" />}>
        <T k="r.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <RefLanding />
      </section>
    </>
  );
}
