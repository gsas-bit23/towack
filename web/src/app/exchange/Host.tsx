"use client";

import { useQuery } from "@tanstack/react-query";
import { Duck } from "@/components/Duck";
import { Pill, type PillTone } from "@/components/ui";
import { api } from "@/lib/exchange/client";
import { useLocale } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/translate";

// The host agent's public report on a deal: an advisory opinion (Claude) + deterministic jury alarms.
// It can only advise and warn; it holds no key and can't change any deal.

export type HostAlarm = { code: string; level: "info" | "warn" | "alert"; n?: number };
export type HostReport = {
  dealId: string;
  phase: string;
  alarms: HostAlarm[];
  advisor: {
    status: "none" | "pending" | "done" | "failed" | "refused" | "disabled";
    opinion?: {
      verdict: "PASS" | "FAIL" | "UNCLEAR";
      confidence: "low" | "medium" | "high";
      summary_en: string;
      summary_zh: string;
      reasons_en: string[];
      reasons_zh: string[];
      manipulation: boolean;
    };
  };
};

/** One request for all visible deals; polls faster while an opinion is being written. */
export function useHostReports(ids: bigint[]) {
  const param = ids.map(String).join(",");
  const { data } = useQuery({
    queryKey: ["ex-host", param],
    enabled: param.length > 0,
    queryFn: () => api<HostReport[]>(`/host?ids=${param}`),
    refetchInterval: (q) => ((q.state.data as HostReport[] | undefined)?.some((r) => r.advisor.status === "pending") ? 8_000 : 60_000),
    retry: 1,
  });
  return new Map((data ?? []).map((r) => [r.dealId, r]));
}

const LEVEL_TONE: Record<HostAlarm["level"], PillTone> = { alert: "down", warn: "gold", info: "line" };
const VERDICT_TONE: Record<string, PillTone> = { PASS: "up", FAIL: "down", UNCLEAR: "line" };

export function HostPanel({ report }: { report?: HostReport }) {
  const { t, locale } = useLocale();
  if (!report) return null;
  const { advisor, alarms } = report;
  const op = advisor.opinion;
  const zh = locale === "zh";
  if (!op && advisor.status !== "pending" && alarms.length === 0) return null;

  return (
    <div className="rounded-xl border border-ion/30 bg-ion/[.05] px-3 py-2.5 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <Duck size={22} tone="ion" />
          {t("host.title")}
        </span>
        <span className="sys-label !text-[10px]">{t("host.advisoryOnly")}</span>
      </div>

      {op ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={VERDICT_TONE[op.verdict]}>{t(`host.verdict.${op.verdict}` as MessageKey)}</Pill>
            <span className="text-muted">{t(`host.conf.${op.confidence}` as MessageKey)}</span>
          </div>
          <p className="mt-1.5 text-sub">{zh ? op.summary_zh : op.summary_en}</p>
          {(zh ? op.reasons_zh : op.reasons_en).length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
              {(zh ? op.reasons_zh : op.reasons_en).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : advisor.status === "pending" ? (
        <p className="mt-2 text-muted">{t("host.reading")}</p>
      ) : null}

      {alarms.length ? (
        <ul className="mt-2 space-y-1">
          {alarms.map((a) => (
            <li key={a.code} className="flex items-start gap-2">
              <Pill tone={LEVEL_TONE[a.level]} className="mt-[1px] shrink-0">
                {t(`host.level.${a.level}` as MessageKey)}
              </Pill>
              <span className="text-sub">{t(`host.alarm.${a.code}` as MessageKey, { n: a.n ?? 0 })}</span>
            </li>
          ))}
        </ul>
      ) : op ? (
        <p className="mt-2 text-muted">{t("host.noAlarms")}</p>
      ) : null}
    </div>
  );
}
