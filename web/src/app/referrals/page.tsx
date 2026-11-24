import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ReferralDesk } from "./ReferralDesk";
import { T } from "@/lib/i18n";

export const metadata: Metadata = { title: "Referrals" };

export default function ReferralsPage() {
  return (
    <>
      <PageHeader title={<T k="ref.title" />}>
        <T k="ref.lead" />
      </PageHeader>
      <section className="mx-auto max-w-[1220px] px-6 pb-16 pt-6">
        <ReferralDesk />
      </section>
    </>
  );
}
