"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Spin } from "@/lib/draw";
import { shortAddr } from "@/lib/format";
import { DECK_SIZE, NO_WIN_ID, PRIZES, prizeById } from "@/lib/prizes";
import { useLocale, type TFn } from "@/lib/i18n";
import { prizeAmount, prizeLabel, prizeShareText, prizeWheel } from "@/lib/prizeText";
import { useNow } from "@/lib/useNow";
import { Confetti, SuccessCheck } from "./motion";
import { SpinWheel, type WheelMode } from "./SpinWheel";
import { Button, Pill } from "./ui";

export type WheelStatus = "none" | "waiting" | "assigned";

/**
 * Wheel + result card. Drives the wheel from on-chain state only:
 *  waiting  -> anticipation spin until PrizeAssigned shows up
 *  assigned -> ease out and stop exactly on prizeId (or snap there if the visitor arrives later)
 */
export function WheelStage({
  status,
  prizeId,
  salt = 0,
  fresh = false,
  demo = false,
  waitingNote,
  actions,
  idleNote,
  size = 460,
}: {
  status: WheelStatus;
  prizeId?: number;
  salt?: number;
  fresh?: boolean;
  demo?: boolean;
  waitingNote?: ReactNode;
  actions?: ReactNode;
  idleNote?: ReactNode;
  size?: number;
}) {
  const { mode, landed, burst, onLanded } = useWheelMachine(status, fresh, prizeId, NO_WIN_ID);
  const { t } = useLocale();

  const prize = prizeById(prizeId);
  const showResult = landed && prize !== undefined && status === "assigned";

  return (
    <div className="relative">
      {demo ? (
        <div className="mb-4 flex justify-center">
          <Pill tone="gold">
            {t("wheel.demoPill")}
          </Pill>
        </div>
      ) : null}
      {/* Confetti gets its own clipped layer (just inside the panel) so the wheel stage itself never clips the needle or result card. */}
      <div className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 overflow-hidden rounded-2xl" aria-hidden="true">
        <Confetti fire={burst} big={Boolean(prize?.jackpot)} />
      </div>
      <SpinWheel mode={mode} prizeId={prizeId} salt={salt} onLanded={onLanded} size={size} />

      <div className="mt-6 min-h-[120px]" aria-live="polite">
        {status === "waiting" || (status === "assigned" && !landed) ? (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-[18px] font-semibold sm:text-[20px]">
              <span className="blink h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
              {status === "waiting" ? t("wheel.waitingVrf") : t("wheel.hereItComes")}
            </div>
            {waitingNote ? <div className="mt-2 text-[14px] text-sub">{waitingNote}</div> : null}
          </div>
        ) : showResult ? (
          <motion.div
            initial={{ y: 12, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className={`rounded-2xl border px-6 py-5 text-center ${prize.kind === "none" ? "border-line bg-card-2" : prize.jackpot ? "gold-hairline border-gold/40 bg-gold/[.06]" : "border-line-2 bg-card-2"}`}
          >
            {prize.kind !== "none" && !demo ? <SuccessCheck className="mx-auto mb-2 h-9 w-9" /> : null}
            <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">{demo ? t("wheel.demoLanded") : prize.kind === "none" ? t("wheel.says") : t("wheel.youWon")}</div>
            <div className={`mt-1 text-[28px] font-semibold leading-tight tracking-tight ${prize.jackpot ? "text-gold" : ""}`}>{prizeLabel(t, prize)}</div>
            <div className="mt-1 font-mono text-[16px] text-sub">
              {prize.kind === "none" ? t("wheel.noPrize") : prizeAmount(t, prize)}
            </div>
            {prize.kind === "bonus" ? <div className="mt-1 text-[13px] text-muted">{t("wheel.onTop")}</div> : null}
            {actions ? <div className="mt-4 flex flex-wrap justify-center gap-3">{actions}</div> : null}
          </motion.div>
        ) : (
          <div className="text-center font-medium text-sub">{idleNote}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Wheel mode state machine for the paid (Draw V1) stage:
 *  waiting  -> anticipation spin until the prize shows up
 *  assigned -> ease out and stop exactly on prizeId (or snap there if the visitor arrives later)
 * Confetti fires on a live landing unless the prize is `noWinId`.
 */
export function useWheelMachine(status: WheelStatus, fresh: boolean, prizeId: number | undefined, noWinId: number) {
  const [mode, setMode] = useState<WheelMode>(status === "none" ? "attract" : status === "waiting" || fresh ? "spinning" : "landed");
  const [landed, setLanded] = useState(false);
  const [burst, setBurst] = useState(0);
  const [prevStatus, setPrevStatus] = useState(status);

  // Status transitions (adjusting state during render on prop change, per React docs).
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "waiting") {
      setLanded(false);
      setMode("spinning");
    } else if (status === "assigned") {
      if (mode !== "spinning") setMode(fresh ? "spinning" : "landed");
    } else {
      setLanded(false);
      setMode("attract");
    }
  }

  // Prize known while spinning: let the anticipation breathe briefly, then ease out onto it.
  useEffect(() => {
    if (status !== "assigned" || mode !== "spinning") return;
    const t = setTimeout(() => setMode("land"), 1200);
    return () => clearTimeout(t);
  }, [status, mode]);

  const onLanded = useCallback(() => {
    setLanded(true);
    if (mode === "land" && prizeId !== undefined && prizeId !== noWinId) setBurst((b) => b + 1);
  }, [mode, prizeId, noWinId]);

  return { mode, landed, burst, onLanded };
}

export function ShareButton({ prizeId, text, path = "/draw" }: { prizeId: number; text?: string; path?: string }) {
  const { t } = useLocale();
  return (
    <Button
      tone="line"
      size="sm"
      onClick={() => {
        const url = `${window.location.origin}${path}`;
        const href = `https://x.com/intent/tweet?text=${encodeURIComponent(text ?? prizeShareText(t, PRIZES[prizeId] ?? PRIZES[NO_WIN_ID]))}&url=${encodeURIComponent(url)}`;
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {t("common.shareX")}
    </Button>
  );
}

/** All 11 tiers with true odds, and live remaining counts when the contract provides them. */
export function PrizeLegend({ remaining }: { remaining?: number[] }) {
  const { t } = useLocale();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PRIZES.map((p) => (
        <div key={p.id} className="lift flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] font-mono text-[12px] font-medium" style={{ background: p.fill, color: p.ink }}>
            {p.kind === "none" ? "✕" : p.id === 0 ? "100%" : prizeWheel(t, p)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight">{prizeLabel(t, p)}</div>
            <div className="font-mono text-[12.5px] text-muted">{prizeAmount(t, p)}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[13.5px] font-medium">
              {p.slots.toLocaleString("en-US")} / {DECK_SIZE.toLocaleString("en-US")}
            </div>
            <div className="font-mono text-[11.5px] text-dim">{remaining ? t("wheel.legendLeft", { n: remaining[p.id].toLocaleString("en-US") }) : t("wheel.legendOdds", { p: ((p.slots / DECK_SIZE) * 100).toFixed(p.slots < 50 ? 1 : 0) })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ago(t: TFn, now: number, at?: number) {
  if (!at || !now) return "";
  const s = Math.max(0, now - at);
  if (s < 60) return t("common.agoS", { n: s });
  if (s < 3600) return t("common.agoM", { n: Math.floor(s / 60) });
  if (s < 86400) return t("common.agoH", { n: Math.floor(s / 3600) });
  return t("common.agoD", { n: Math.floor(s / 86400) });
}

/** Live ticker of recent PrizeAssigned events. */
export function SpinFeed({ spins, emptyText }: { spins: Spin[]; emptyText?: string }) {
  const now = useNow(10_000);
  const { t } = useLocale();
  if (spins.length === 0) {
    return <div className="rounded-2xl border border-dashed border-line-2 bg-card-2 px-4 py-6 text-center font-medium text-muted">{emptyText ?? t("wheel.feedEmpty")}</div>;
  }
  return (
    <ul className="overflow-hidden rounded-xl border border-line">
      <AnimatePresence initial={false}>
        {spins.map((s) => {
          const p = PRIZES[s.prizeId] ?? PRIZES[10];
          return (
            <motion.li
              key={s.key}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="flex items-center gap-3 border-t border-line bg-card px-4 py-2.5 first:border-t-0"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.kind === "none" ? "#3A414B" : p.fill }} aria-hidden="true" />
              <span className="font-mono text-[13px] text-sub">{shortAddr(s.minter)}</span>
              <span className={`flex-1 text-right text-[14px] font-semibold ${p.jackpot ? "text-gold" : p.kind === "none" ? "text-muted" : ""}`}>{prizeLabel(t, p)}</span>
              <span className="w-[62px] text-right font-mono text-[11.5px] text-dim">{s.demo ? t("common.demo") : ago(t, now, s.time)}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
