"use client";

import { useMemo, useState } from "react";
import { useReadContracts, useWriteContract } from "wagmi";
import { rebateDistributorAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { ChainNote, NeedsContracts, NeedsWallet, RpcErrorNotice, TxNotice } from "@/components/status";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useLocale, type MessageKey } from "@/lib/i18n";

const MAX_EPOCHS_SHOWN = 120;

export function RebateBooth() {
  const { t } = useLocale();
  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 lg:col-span-8">
        <NeedsContracts keys={["rebateDistributor"]}>
          <EpochTable />
        </NeedsContracts>
      </div>
      <div className="col-span-12 lg:col-span-4">
        <Panel tone="raised" shadow={false}>
          <h2 className="text-[20px] font-semibold tracking-tight">{t("reb.how")}</h2>
          <ul className="mt-3 space-y-2 font-medium text-sub">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <li key={n} className="flex gap-2.5">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                <span>{t(`reb.how${n}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-semibold text-sub">{t("reb.note")}</p>
        </Panel>
      </div>
    </div>
  );
}

function EpochTable() {
  const { chainId, addresses, account } = useTowack();
  const dist = addresses.rebateDistributor!;
  const now = useNow();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const { t } = useLocale();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const c = { address: dist, abi: rebateDistributorAbi, chainId } as const;
  const { data: meta, isError: metaErr, refetch: refetchMeta } = useReadContracts({
    contracts: [
      { ...c, functionName: "currentEpoch" },
      { ...c, functionName: "finalizedEpochs" },
      { ...c, functionName: "startTime" },
      { ...c, functionName: "EPOCH_LENGTH" },
      { ...c, functionName: "carryTokens" },
      { ...c, functionName: "carryBnb" },
    ],
    query: { refetchInterval: 30_000 },
  });
  const current = meta?.[0]?.result as bigint | undefined;
  const finalized = meta?.[1]?.result as bigint | undefined;
  const start = meta?.[2]?.result as bigint | undefined;
  const epochLen = (meta?.[3]?.result as bigint | undefined) ?? 604800n;

  const curN = current !== undefined ? Number(current) : undefined;
  const finN = finalized !== undefined ? Number(finalized) : 0;
  const epochs = useMemo(() => {
    if (curN === undefined) return [] as number[];
    const lo = Math.max(0, curN - MAX_EPOCHS_SHOWN + 1);
    const list: number[] = [];
    for (let e = curN; e >= lo; e--) list.push(e);
    return list;
  }, [curN]);

  const { data: rows } = useReadContracts({
    contracts: epochs.flatMap((e) => [
      { ...c, functionName: "claimable", args: account ? [account, BigInt(e)] : undefined },
      { ...c, functionName: "claimed", args: account ? [BigInt(e), account] : undefined },
      { ...c, functionName: "feesOf", args: account ? [BigInt(e), account] : undefined },
      { ...c, functionName: "totalFees", args: [BigInt(e)] },
    ]),
    query: { enabled: Boolean(account && epochs.length), refetchInterval: 30_000 },
  });

  const table = epochs.map((e, i) => {
    const cl = rows?.[i * 4]?.result as readonly [bigint, bigint] | undefined;
    return {
      e,
      tokens: cl?.[0] ?? 0n,
      bnb: cl?.[1] ?? 0n,
      claimed: rows?.[i * 4 + 1]?.result as boolean | undefined,
      myFees: (rows?.[i * 4 + 2]?.result as bigint | undefined) ?? 0n,
      total: (rows?.[i * 4 + 3]?.result as bigint | undefined) ?? 0n,
      finalized: e < finN,
      live: e === curN,
    };
  });
  const visible = table.filter((r) => r.live || r.myFees > 0n || r.tokens > 0n || r.bnb > 0n);
  const claimableRows = table.filter((r) => r.finalized && !r.claimed && (r.tokens > 0n || r.bnb > 0n));
  const pendingCheckpoint = curN !== undefined && finN < curN;
  const sel = claimableRows.filter((r) => selected.has(r.e));
  const sumT = sel.reduce((a, r) => a + r.tokens, 0n);
  const sumB = sel.reduce((a, r) => a + r.bnb, 0n);
  const nextEnd = start !== undefined && current !== undefined ? Number(start + (current + 1n) * epochLen) : undefined;

  const toggle = (e: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });

  async function claim() {
    const list = sel.map((r) => BigInt(r.e));
    if (!list.length) return;
    const ok = await tx.run(t("reb.txClaim"), () =>
      writeContractAsync({ address: dist, abi: rebateDistributorAbi, functionName: "claim", args: [list], chainId }),
    );
    if (ok) setSelected(new Set());
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[21px] font-semibold tracking-tight">{t("reb.epochs")}</h2>
        <ChainNote />
      </div>
      {metaErr ? <RpcErrorNotice onRetry={() => void refetchMeta()} label={t("reb.loadErr")} /> : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Stat label={t("reb.current")} value={curN !== undefined ? `#${curN}` : "—"} sub={nextEnd && now ? t("reb.endsIn", { d: fmtDuration(nextEnd - now) }) : undefined} />
        <Stat label={t("reb.finalized")} value={finalized !== undefined ? (finN > 0 ? `#${finN - 1}` : t("reb.noneYet")) : "—"} />
        <Stat label={t("reb.started")} value={start ? fmtDate(start).split(",")[0] : "—"} sub={t("reb.epoch0")} />
      </div>
      {pendingCheckpoint ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
          <span>{t("reb.pending")}</span>
          {account ? (
            <Button
              tone="line"
              size="sm"
              disabled={tx.busy}
              onClick={() => tx.run(t("reb.txCheckpoint"), () => writeContractAsync({ address: dist, abi: rebateDistributorAbi, functionName: "checkpoint", chainId }))}
            >
              {t("reb.runCheckpoint")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6">
        <NeedsWallet why={t("reb.connectWhy")} agent="rebateClaim">
          {visible.length === 0 ? (
            <p className="rounded-2xl bg-card-2 px-4 py-6 text-center font-medium">{t("reb.noActivity")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-y-2 text-left font-medium">
                <thead className="text-[12px] uppercase tracking-widest text-muted">
                  <tr>
                    <th className="px-3">{t("reb.pick")}</th>
                    <th className="px-3">{t("reb.epoch")}</th>
                    <th className="px-3">{t("reb.yourFees")}</th>
                    <th className="px-3">{t("reb.share")}</th>
                    <th className="px-3">{t("reb.claimable")}</th>
                    <th className="px-3">{t("reb.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const can = claimableRows.includes(r);
                    const share = r.total > 0n ? Number((r.myFees * 10000n) / r.total) / 100 : 0;
                    return (
                      <tr key={r.e} className="bg-card-2">
                        <td className="rounded-l-2xl px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-gold"
                            disabled={!can}
                            checked={selected.has(r.e)}
                            onChange={() => toggle(r.e)}
                            aria-label={t("reb.selectEpoch", { n: r.e })}
                          />
                        </td>
                        <td className="px-3 py-3 font-display font-semibold">#{r.e}</td>
                        <td className="px-3 py-3">{fmt18(r.myFees, 6)} BNB</td>
                        <td className="px-3 py-3">{share.toFixed(2)}%</td>
                        <td className="px-3 py-3">
                          {r.finalized ? (
                            <>
                              {fmt18(r.tokens, 2)} TWAK
                              <br />
                              <span className="text-sm text-muted">+ {fmt18(r.bnb, 6)} BNB</span>
                            </>
                          ) : (
                            <span className="text-muted">{t("reb.afterWeek")}</span>
                          )}
                        </td>
                        <td className="rounded-r-2xl px-3 py-3">
                          {r.live ? <Pill tone="neutral">{t("reb.live")}</Pill> : r.claimed ? <Pill tone="line">{t("reb.claimed")}</Pill> : r.finalized ? can ? <Pill tone="gold">{t("reb.ready")}</Pill> : <Pill tone="line">—</Pill> : <Pill tone="line">{t("reb.tallying")}</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-4">
            <div className="font-medium">
              {t("reb.selected")} <span className="font-display font-semibold">{fmt18(sumT, 2)} TWAK</span> + <span className="font-display font-semibold">{fmt18(sumB, 6)} BNB</span>
            </div>
            <div className="flex gap-3">
              <Button tone="line" size="sm" disabled={!claimableRows.length} onClick={() => setSelected(new Set(claimableRows.map((r) => r.e)))}>
                {t("reb.selectAll")}
              </Button>
              <Button tone="gold" size="sm" disabled={!sel.length || tx.busy} onClick={claim}>
                {tx.busy ? t("wallet.checkWallet") : sel.length ? t("reb.claimN", { n: sel.length }) : t("reb.claimNone")}
              </Button>
            </div>
          </div>
          <TxNotice state={tx.state} onClose={tx.reset} />
          <AgentPathToggle flow="rebateClaim" className="mt-4" />
        </NeedsWallet>
      </div>
    </Panel>
  );
}
