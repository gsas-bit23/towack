"use client";

import { useReadContracts, useWriteContract } from "wagmi";
import { teamVestingAbi } from "@/abi";
import { AddressLink, DeployingSoon, TxNotice } from "@/components/status";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

const DAY = 86400;
const CLIFF_DAYS = 365;
const VEST_DAYS = 1460;

function Schedule() {
  return (
    <div className="mt-5">
      <div className="flex h-10 overflow-hidden rounded-2xl border border-line" aria-hidden="true">
        <div className="checker grid place-items-center bg-card-2 opacity-60" style={{ width: "20%" }} />
        <div className="bg-gradient-to-r from-card-2 to-card" style={{ width: "80%" }} />
      </div>
      <div className="mt-2 flex justify-between text-[13px] font-semibold text-muted">
        <span>Deploy</span>
        <span>Cliff (1 year) — nothing unlocks</span>
        <span>then daily for 4 years →</span>
        <span>~5 years: 100%</span>
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
        <h2 className="font-display text-[28px] font-semibold">Team vesting · 50M TWAK (5%)</h2>
        {isBeneficiary ? <Pill tone="gold">YOU ARE THE BENEFICIARY</Pill> : null}
      </div>
      <p className="mt-1 font-semibold text-sub">
        Start = contract deploy. {CLIFF_DAYS}-day cliff with nothing unlocked, then linear daily over {VEST_DAYS} days. No listing unlock, no owner, no
        revocation. The beneficiary is fixed.
      </p>
      <Schedule />
      {!has("teamVesting") ? (
        <div className="mt-6">
          <DeployingSoon keys={["teamVesting"]} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Started" value={start ? fmtDate(start).split(",").slice(0, 2).join(",") : "—"} />
            <Stat label="Cliff ends" value={cliffEnd ? fmtDate(cliffEnd).split(",").slice(0, 2).join(",") : "—"} sub={inCliff ? "in cliff" : undefined} />
            <Stat label="Vested" value={`${fmt18(vested, 0)}`} sub={`${pct.toFixed(2)}% of 50M`} />
            <Stat label="Claimable now" value={fmt18(releasable, 0)} sub={`released ${fmt18(released, 0)}`} />
          </div>
          <div className="mt-4 h-6 overflow-hidden rounded-full border border-line bg-card-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Vested">
            <div className="h-full w-full origin-left bg-gold" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="font-medium text-sub">
              Beneficiary: <AddressLink address={beneficiary} /> · Fully vested {fullAt ? fmtDate(fullAt).split(",").slice(0, 2).join(",") : "—"}
            </div>
            {account ? (
              <Button
                tone={isBeneficiary ? "gold" : "line"}
                size="sm"
                disabled={!releasable || releasable === 0n || bound === false || tx.busy}
                onClick={() =>
                  tx.run("Release vested TWAK", () => writeContractAsync({ address: vest!, abi: teamVestingAbi, functionName: "release", chainId }))
                }
              >
                Release to beneficiary
              </Button>
            ) : null}
          </div>
          {account && !isBeneficiary ? (
            <p className="mt-2 text-sm font-semibold text-muted">You&apos;re not the beneficiary. Anyone may trigger a release, but tokens only ever go to the beneficiary.</p>
          ) : null}
          <TxNotice state={tx.state} onClose={tx.reset} />
        </>
      )}
    </Panel>
  );
}
