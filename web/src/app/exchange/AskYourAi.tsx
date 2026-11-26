"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { buildCopyPrompt, type AdvisorInput } from "@/lib/advisorPrompt";
import { useLocale } from "@/lib/i18n";

// Free alternative to the server advisor: copy the host agent's hardened prompt (evidence wrapped as untrusted data)
// and paste it into any chat AI the judge already uses. Nothing is sent anywhere by the site; the judge still decides.
export function AskYourAi({ input }: { input: AdvisorInput }) {
  const { t, locale } = useLocale();
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const prompt = buildCopyPrompt(input, locale === "zh" ? "zh" : "en");

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setState("copied");
    } catch {
      setState("manual"); // clipboard blocked: show the text to copy by hand
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card-2/60 px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{t("ask.title")}</span>
        <Button tone="soft" size="sm" onClick={copy}>
          {state === "copied" ? t("ask.copied") : t("ask.copy")}
        </Button>
      </div>
      <p className="mt-1 text-muted">{state === "copied" ? t("ask.pasteHint") : t("ask.body")}</p>
      {state === "manual" ? (
        <textarea
          readOnly
          className="mt-2 h-40 w-full rounded-lg border border-line-2 bg-bg p-2 font-mono text-[11.5px] text-sub"
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t("ask.title")}
        />
      ) : null}
    </div>
  );
}
