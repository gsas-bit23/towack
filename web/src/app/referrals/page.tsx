import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ReferralDesk } from "./ReferralDesk";

export const metadata: Metadata = { title: "Referrals" };

export default function ReferralsPage() {
  return (
    <>
      <PageHeader kicker="Paid mint only · 0.005 BNB per friend" title="Bring a friend, earn BNB." tone="candy">
        Share your link. Every paid mint that names your wallet as referrer credits you 0.005 BNB (5% of the 0.1 BNB price) from the mint
        contract. Your friend pays the same 0.1 BNB. You need an Agent ID to earn, and you claim whenever you like. Genesis 300 has no referrals.
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <ReferralDesk />
      </section>
    </>
  );
}
