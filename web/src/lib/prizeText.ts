// Locale-aware prize copy. The numeric data stays in prizes.ts / poolPrizes.ts / genesisPrizes.ts.

import type { MessageKey, TFn } from "@/lib/i18n";
import type { PoolPrize } from "./poolPrizes";
import type { Prize } from "./prizes";

const k = (s: string) => s as MessageKey;

export const prizeLabel = (t: TFn, p: Prize) => t(k(`prize.label.${p.id}`));
/** BNB tiers and "no prize" read as words; TWAK bonus amounts ("+320,000 TWAK") are language-neutral. */
export const prizeAmount = (t: TFn, p: Prize) => (p.kind === "bonus" ? p.amount : t(k(`prize.amount.${p.id}`)));
/** Short rim text on the wheel: only FULL / TRY AGAIN are words. */
export const prizeWheel = (t: TFn, p: Prize) => (p.id === 0 || p.id === 10 ? t(k(`prize.wheel.${p.id}`)) : p.wheel);

export function prizeShareText(t: TFn, p: Prize): string {
  const prize = p.kind === "none" ? t("prize.shareNone") : `${prizeLabel(t, p)} (${prizeAmount(t, p)})`;
  return t("prize.share", { prize });
}

export function poolLabel(t: TFn, p: PoolPrize): string {
  if (p.id === 0) return t("pool.label.0");
  if (p.id === 6) return t("pool.label.6");
  return t("pool.label.back", { m: p.wheel });
}

export const poolShareText = (t: TFn, p: PoolPrize) => t("pool.share", { m: p.wheel });

export const genesisShareText = (t: TFn, mintIndex?: number) => t("genesis.share", { n: mintIndex ? ` #${mintIndex}` : "" });
