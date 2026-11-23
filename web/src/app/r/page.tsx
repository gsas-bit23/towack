import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { RefLanding } from "./RefLanding";

export const metadata: Metadata = { title: "You're invited" };

// Friend landing for /r/<handle>?ref=<address>. next.config.ts rewrites /r/:handle here (the browser URL keeps the
// handle), so this is one static page; the handle and `ref` are read client-side from the URL. There is no on-chain
// SPACE ID resolver: `ref` is the referrer.
export default function RefPage() {
  return (
    <>
      <PageHeader kicker="Agent ID holders only · 0.1 BNB + VRF fee" title="A friend sent you a spin.">
        Mint one Towack slot for 0.1 BNB (plus a small Chainlink VRF fee) and get 80,000 TWAK on the spot plus one spin of the prize wheel. Your
        friend earns 0.005 BNB from the contract when you mint with their link. Your price stays the same.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <RefLanding />
      </section>
    </>
  );
}
