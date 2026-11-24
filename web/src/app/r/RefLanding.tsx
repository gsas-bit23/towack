"use client";

import { AgentPathPanel } from "@/components/AgentPath";
import { ButtonLink, Panel, Pill } from "@/components/ui";
import { mintHref, shortAddr, useReferralFromUrl } from "@/lib/referral";
import { useLocale, type MessageKey } from "@/lib/i18n";

export function RefLanding() {
  const urlRef = useReferralFromUrl();
  const { t, rich } = useLocale();

  // The referrer wallet comes ONLY from the `?ref=` the referrer put in their own link. The handle is a display
  // label: this page never resolves a name.ai to a wallet, so it can't be used to look up other people's wallets by
  // name (Agent ID Hackathon rule).
  const ref = { address: urlRef.address, handle: urlRef.handle };

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 space-y-8 lg:col-span-5">
        <Panel>
          <Pill tone="gold">{t("r.invitedBy")}</Pill>
          <div className="mt-3 font-display text-[36px] font-semibold leading-tight break-words">{ref.handle ?? t("r.friend")}</div>
          {ref.address ? (
            <p className="mt-2 font-mono text-sm font-medium text-sub break-all" title={ref.address}>
              {t("r.wallet", { a: shortAddr(ref.address) })}
            </p>
          ) : (
            <p className="mt-3 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
              {rich("r.noRef", { code: (c) => <code className="rounded bg-card px-1">{c}</code> })}
            </p>
          )}
          <ButtonLink href={mintHref(ref)} tone="gold" size="lg" className="mt-6 w-full">
            {t("r.mint")}
          </ButtonLink>
          <ul className="mt-6 space-y-2 font-medium text-sub">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-2.5">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span>{t(`r.b${n}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="col-span-12 lg:col-span-7">
        <Panel tone="raised" shadow={false}>
          <h2 className="text-[20px] font-semibold tracking-tight">{t("r.agentTitle")}</h2>
          <p className="mt-1 font-medium text-sub">{t("r.agentBody")}</p>
          <AgentPathPanel flow="launch" referral={ref.address ? ref : undefined} className="mt-4" />
        </Panel>
      </div>
    </div>
  );
}
