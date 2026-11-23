import type { Metadata } from "next";
import { PerpsDesk } from "./PerpsDesk";

export const metadata: Metadata = { title: "Perps" };

export default function PerpsPage() {
  return (
    <section className="mx-auto max-w-[1880px] px-3 pb-24 pt-4 sm:px-4 lg:pb-12 lg:pt-5">
      <PerpsDesk />
    </section>
  );
}
