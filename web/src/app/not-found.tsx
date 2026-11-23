import Link from "next/link";
import { Panel } from "@/components/ui";
import { T } from "@/lib/i18n";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-[720px] px-6 py-20">
      <Panel className="text-center">
        <div className="inline-block rounded-full border border-line bg-card-2 px-4 py-1 text-xs font-semibold text-gold">404</div>
        <h1 className="mt-4 font-display text-[40px] font-semibold leading-tight">
          <T k="nf.title" />
        </h1>
        <p className="mt-2 font-medium text-sub">
          <T k="nf.body" />
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="press inline-flex min-h-12 items-center justify-center rounded-[10px] bg-gold px-6 text-[15px] font-semibold text-on-gold hover:bg-gold-2"
          >
            <T k="nf.home" />
          </Link>
        </div>
      </Panel>
    </section>
  );
}
