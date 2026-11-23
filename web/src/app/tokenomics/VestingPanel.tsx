"use client";

import { useReadContracts, useWriteContract } from "wagmi";
import { teamVestingAbi } from "@/abi";
import { AddressLink, DeployingSoon, TxNotice } from "@/components/status";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useLocale } from "@/lib/i18n";

const DAY = 86400;
const CLIFF_DAYS = 365;
const VEST_DAYS = 1460;

function Schedule() {
  const { t } = useLocale();
  return (
    <div className="mt-5">
      <div className="flex h-10 overflow-hidden rounded-2xl border border-line" aria-hidden="true">
        <div className="checker grid place-items-center bg-card-2 opacity-60" style={{ width: "20%" }} />
        <div className="bg-gradient-to-r from-card-2 to-card" style={{ width: "80%" }} />
      </div>
      <div className="mt-2 flex justify-between text-[13px] font-semibold text-muted">
        <span>{t("vest.deploy")}</span>
        <span>{t("vest.cliff")}</span>
        <span>{t("vest.daily")}</span>
        <span>{t("vest.full")}</span>
      </div>
    </div>
  );
}

export function VestingPanel() {
  const { chainId, addresses, account, has } = useTowack();
  const vest = addresses.teamVesting;
  const now = useNow(60_000);
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const { t } = useLocale();

  const c = { address: vest, abi: teamVestingAbi, chainId } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...c, functionName: "beneficiary" },
      { ...c, functionName: "start" },
      { ...c, functionName: "cliffEnd" },
      { ...c, functionName: "released" },
      { ...c, functionName: "releasable" },
      { ...c, functionName: "TOTAL" },
      { ...c, functionName: "token" },
    ],
    query: { enabled: Boolean(vest), refetchInterval: 60_000 },
  });
  const beneficiary = data?.[0]?.result as `0x${string}` | undefined;
  const start = data?.[1]?.result as bigint | undefined;
  const cliffEnd = data?.[2]?.result as bigint | undefined;
  const released = data?.[3]?.result as bigint | undefined;
  const releasable = data?.[4]?.result as bigint | undefined;
  const total = (data?.[5]?.result as bigint | undefined) ?? 50_000_000n * 10n ** 18n;
  const bound = data?.[6]?.result ? !/^0x0{40}$/i.test(data[6].result as string) : undefined;

  const vested = released !== undefined && releasable !== undefined ? released + releasable : undefined;
  const isBeneficiary = Boolean(account && beneficiary && account.toLowerCase() === beneficiary.toLowerCase());
  const fullAt = cliffEnd !== undefined ? Number(cliffEnd) + VEST_DAYS * DAY : undefined;
  const pct = vested !== undefined ? Number((vested * 10000n) / total) / 100 : 0;
  const inCliff = cliffEnd !== undefined && now > 0 && BigInt(now) < cliffEnd;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-semibold">{t("vest.title")}</h2>
        {isBeneficiary ? <Pill tone="gold">{t("vest.youBen")}</Pill> : null}
      </div>
      <p className="mt-1 font-semibold text-sub">
        {t("vest.body", { cliff: CLIFF_DAYS, days: VEST_DAYS })}
      </p>
      <Schedule />
      {!has("teamVesting") ? (
        <div className="mt-6">
          <DeployingSoon keys={["teamVesting"]} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("vest.started")} value={start ? fmtDate(start).split(",").slice(0, 2).join(",") : "—"} />
            <Stat label={t("vest.cliffEnds")} value={cliffEnd ? fmtDate(cliffEnd).split(",").slice(0, 2).join(",") : "—"} sub={inCliff ? t("vest.inCliff") : undefined} />
            <Stat label={t("vest.vested")} value={`${fmt18(vested, 0)}`} sub={t("vest.ofTotal", { p: pct.toFixed(2) })} />
            <Stat label={t("vest.claimable")} value={fmt18(releasable, 0)} sub={t("vest.released", { n: fmt18(released, 0) })} />
          </div>
          <div className="mt-4 h-6 overflow-hidden rounded-full border border-line bg-card-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("vest.vested")}>
            <div className="h-full w-full origin-left bg-gold" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="font-medium text-sub">
              {t("vest.beneficiary")} <AddressLink address={beneficiary} /> ·{" "}
              {t("vest.fully", { date: fullAt ? fmtDate(fullAt).split(",").slice(0, 2).join(",") : "—" })}
            </div>
            {account ? (
              <Button
                tone={isBeneficiary ? "gold" : "line"}
                size="sm"
                disabled={!releasable || releasable === 0n || bound === false || tx.busy}
                onClick={() =>
                  tx.run(t("vest.txRelease"), () => writeContractAsync({ address: vest!, abi: teamVestingAbi, functionName: "release", chainId }))
                }
              >
                {t("vest.release")}
              </Button>
            ) : null}
          </div>
          {account && !isBeneficiary ? (
            <p className="mt-2 text-sm font-semibold text-muted">{t("vest.notBen")}</p>
          ) : null}
          <TxNotice state={tx.state} onClose={tx.reset} />
        </>
      )}
    </Panel>
  );
}
