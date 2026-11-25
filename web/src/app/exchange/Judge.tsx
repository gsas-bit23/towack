"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { useReadContracts, useSignMessage, useWriteContract } from "wagmi";
import { agentDealsV2Abi, agentIdAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { NeedsWallet, TxNotice } from "@/components/status";
import { Button, Panel, Pill } from "@/components/ui";
import { juryPhase, saltFromSignature, saltMessage, scanIds, textHash, toDeal, toJury, voteCommitment, type BallotTuple, type Deal, type DealTuple, type Jury, type JuryTuple } from "@/lib/deals";
import { api } from "@/lib/exchange/client";
import { useTowack } from "@/lib/chain";
import { fmt18 } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { JuryBox, type EvidenceRow } from "./Deals";

const VOTE_KEY = "towack.judge.votes.v1"; // local backup of {contract:dealId → pass}; the salt is re-derived by signing

function loadVotes(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(VOTE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
function saveVote(key: string, pass: boolean) {
  try {
    window.localStorage.setItem(VOTE_KEY, JSON.stringify({ ...loadVotes(), [key]: pass }));
  } catch {
    /* storage blocked: the vote is recovered by re-signing and matching the commitment */
  }
}

/** Judge tab: any Agent ID holder reviews delivered deals and votes PASS / FAIL with sealed votes. */
export function Judge() {
  const { t } = useLocale();
  const { addresses } = useTowack();
  if (!addresses.agentDealsV2) return <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("deal.notDeployed")}</p>;
  return (
    <div className="space-y-4">
      <Panel tone="flat" className="!py-4 text-[14px] text-sub">
        <p className="font-semibold text-fg">{t("jury.title")}</p>
        <p className="mt-1">{t("jury.how")}</p>
        <p className="mt-2">{t("jury.rule")}</p>
        <p className="mt-2 font-medium text-fg">{t("jury.guide")}</p>
      </Panel>
      <NeedsWallet>
        <JudgeLive deals={addresses.agentDealsV2} />
      </NeedsWallet>
      <AgentPathToggle flow="judge" />
    </div>
  );
}

function JudgeLive({ deals }: { deals: Address }) {
  const { t } = useLocale();
  const { chainId, account, addresses } = useTowack();
  const now = useNow(15_000);
  const c = { address: deals, abi: agentDealsV2Abi, chainId } as const;

  const { data: base, refetch: refetchBase } = useReadContracts({
    contracts: [
      { ...c, functionName: "dealCount" },
      { ...c, functionName: "twak" },
      { address: addresses.agentId, abi: agentIdAbi, functionName: "balanceOf", args: account ? [account] : undefined, chainId },
    ],
    query: { refetchInterval: 20_000 },
  });
  const dealCount = base?.[0]?.result as bigint | undefined;
  const twak = base?.[1]?.result as Address | undefined;
  const hasAgentId = base?.[2]?.status === "success" ? (base[2].result as bigint) > 0n : undefined;

  const ids = useMemo(() => (dealCount ? scanIds(dealCount) : []), [dealCount]);
  const { data: rows, refetch: refetchRows } = useReadContracts({
    contracts: ids.map((id) => ({ ...c, functionName: "deals" as const, args: [id] as const })),
    query: { enabled: ids.length > 0, refetchInterval: 20_000 },
  });
  const all = useMemo(() => (rows ?? []).flatMap((r, i) => (r.status === "success" ? [toDeal(ids[i], r.result as unknown as DealTuple)] : [])), [rows, ids]);
  // Deals with a jury (delivered, or settled after delivery) that this wallet is not a party to.
  const judged = all.filter((d) => d.deliveredAt > 0 && account && d.provider.toLowerCase() !== account.toLowerCase() && d.client.toLowerCase() !== account.toLowerCase());

  const { data: extra, refetch: refetchExtra } = useReadContracts({
    contracts: judged.flatMap((d) => [
      { ...c, functionName: "juries" as const, args: [d.id] as const },
      { ...c, functionName: "ballots" as const, args: [d.id, account!] as const },
      { ...c, functionName: "claimable" as const, args: [d.id, account!] as const },
    ]),
    query: { enabled: judged.length > 0 && Boolean(account), refetchInterval: 20_000 },
  });
  const juryOf = (i: number) => toJury(extra?.[i * 3]?.result as JuryTuple | undefined);
  const ballotOf = (i: number) => extra?.[i * 3 + 1]?.result as BallotTuple | undefined;
  const claimableOf = (i: number) => (extra?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n;

  const idsParam = judged.map((d) => String(d.id)).join(",");
  const { data: evidence } = useQuery({
    queryKey: ["ex-evidence", idsParam],
    enabled: idsParam.length > 0,
    queryFn: () => api<EvidenceRow[]>(`/evidence?ids=${idsParam}`),
    refetchInterval: 60_000,
  });
  const evidenceOf = new Map((evidence ?? []).map((e) => [e.dealId, e]));

  const { writeContractAsync } = useWriteContract();
  const claimTx = useTx();
  const claimIds = judged.filter((_, i) => claimableOf(i) > 0n).map((d) => d.id);
  const refresh = () => {
    void refetchBase();
    void refetchRows();
    void refetchExtra();
  };

  const open = judged.map((d, i) => ({ d, i })).filter(({ d }) => now > 0 && ["commit", "reveal", "finalize"].includes(juryPhase(d, now)));
  const mineSettled = judged.map((d, i) => ({ d, i })).filter(({ d, i }) => now > 0 && juryPhase(d, now) === "settled" && ballotOf(i)?.[1]);

  return (
    <div className="space-y-4">
      {hasAgentId === false ? <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 text-[14px] font-medium">{t("jury.noAgentId")}</p> : null}
      {claimIds.length ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 !py-4">
          <span className="font-semibold">{t("jury.rewardsReady", { n: claimIds.length })}</span>
          <Button
            tone="gold"
            size="sm"
            disabled={claimTx.busy}
            onClick={() => claimTx.run(t("jury.txClaim"), () => writeContractAsync({ ...c, functionName: "claimJudgeRewards", args: [claimIds] })).then(refresh)}
          >
            {t("jury.claimAll")}
          </Button>
          <TxNotice state={claimTx.state} onClose={claimTx.reset} />
        </Panel>
      ) : null}
      <h3 className="pt-1 font-semibold">{t("jury.open")}</h3>
      {dealCount !== undefined && open.length === 0 ? <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("jury.none")}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {open.map(({ d, i }) => (
          <CaseCard
            key={String(d.id)}
            deal={d}
            jury={juryOf(i)}
            ballot={ballotOf(i)}
            deals={deals}
            isTwak={Boolean(twak && d.token.toLowerCase() === twak.toLowerCase())}
            evidence={evidenceOf.get(String(d.id))}
            canJudge={hasAgentId === true}
            onDone={refresh}
          />
        ))}
      </div>
      {mineSettled.length ? (
        <>
          <h3 className="pt-1 font-semibold">{t("jury.history")}</h3>
          <ul className="space-y-1.5 text-[13.5px]">
            {mineSettled.map(({ d, i }) => {
              const j = juryOf(i);
              const b = ballotOf(i)!;
              const won = claimableOf(i) > 0n || b[3];
              return (
                <li key={String(d.id)} className="flex flex-wrap justify-between gap-2 rounded-xl bg-card-2 px-3 py-2">
                  <span>
                    {t("deal.title", { id: String(d.id) })} · {t(b[2] ? "jury.youPass" : "jury.youFail")} ·{" "}
                    {j.verdict === "none" ? t("jury.settledByParty") : t(j.verdict === "pass" ? "jury.verdictPass" : "jury.verdictFail", { pass: j.passVotes, fail: j.failVotes })}
                  </span>
                  <span className={won ? "font-semibold text-up" : "text-muted"}>{won ? t(b[3] ? "jury.claimed" : "jury.won") : t("jury.noReward")}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function CaseCard({
  deal,
  jury,
  ballot,
  deals,
  isTwak,
  evidence,
  canJudge,
  onDone,
}: {
  deal: Deal;
  jury: Jury;
  ballot?: BallotTuple;
  deals: Address;
  isTwak: boolean;
  evidence?: EvidenceRow;
  canJudge: boolean;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const { chainId, account } = useTowack();
  const now = useNow(15_000);
  const phase = juryPhase(deal, now);
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const tx = useTx();
  const [err, setErr] = useState<string>();
  const c = { address: deals, abi: agentDealsV2Abi, chainId } as const;
  const sym = isTwak ? "TWAK" : "USDT";
  const reward = (deal.amount * 50n) / 10_000n;
  const committed = Boolean(ballot && !/^0x0{64}$/.test(ballot[0]));
  const revealed = Boolean(ballot?.[1]);
  const key = `${deals.toLowerCase()}:${deal.id}`;

  const termsOk = evidence?.terms != null ? textHash(evidence.terms) === deal.termsHash : undefined;
  const deliveryOk = evidence?.delivery != null ? textHash(evidence.delivery) === deal.deliveryHash : undefined;

  async function salt(): Promise<Hex> {
    const sig = await signMessageAsync({ message: saltMessage(deals, deal.id) });
    return saltFromSignature(sig);
  }

  async function commit(pass: boolean) {
    if (!account) return;
    setErr(undefined);
    let s: Hex;
    try {
      s = await salt();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    saveVote(key, pass);
    const ok = await tx.run(t(pass ? "jury.txCommitPass" : "jury.txCommitFail"), () =>
      writeContractAsync({ ...c, functionName: "commitVote", args: [deal.id, voteCommitment(deal.id, account, pass, s)] }),
    );
    if (ok) onDone();
  }

  async function reveal() {
    if (!account || !ballot) return;
    setErr(undefined);
    let s: Hex;
    try {
      s = await salt();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    // Which vote matches the sealed commitment? (works even if local storage was cleared)
    const pass = voteCommitment(deal.id, account, true, s) === ballot[0] ? true : voteCommitment(deal.id, account, false, s) === ballot[0] ? false : undefined;
    if (pass === undefined) {
      setErr(t("jury.saltMismatch"));
      return;
    }
    const ok = await tx.run(t("jury.txReveal"), () => writeContractAsync({ ...c, functionName: "revealVote", args: [deal.id, pass, s] }));
    if (ok) onDone();
  }

  const finalize = () => tx.run(t("deal.act.finalize"), () => writeContractAsync({ ...c, functionName: "finalize", args: [deal.id] })).then((ok) => ok && onDone());
  const myVote = (() => {
    if (revealed) return ballot![2];
    try {
      return loadVotes()[key];
    } catch {
      return undefined;
    }
  })();

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-display text-[18px] font-semibold">{t("deal.title", { id: String(deal.id) })}</div>
        <Pill tone="gold">{t("jury.rewardPool", { amount: fmt18(reward), token: sym })}</Pill>
      </div>
      <div className="font-mono text-[20px] font-medium">
        {fmt18(deal.amount)} <span className="text-[14px] text-muted">{sym}</span>
      </div>
      <JuryBox deal={deal} jury={jury} phase={phase} />

      <div className="space-y-2 text-[13px]">
        <EvidenceBlock label={t("jury.terms")} text={evidence?.terms} ok={termsOk} />
        <EvidenceBlock label={t("jury.delivery")} text={evidence?.delivery} ok={deliveryOk} />
      </div>

      {err ? <p className="text-[13px] text-down">{err}</p> : null}
      {phase === "commit" && !committed ? (
        canJudge ? (
          <div className="flex flex-wrap gap-2">
            <Button tone="gold" size="sm" disabled={tx.busy} onClick={() => commit(true)}>
              {t("jury.votePass")}
            </Button>
            <Button tone="danger" size="sm" disabled={tx.busy} onClick={() => commit(false)}>
              {t("jury.voteFail")}
            </Button>
          </div>
        ) : null
      ) : null}
      {phase === "commit" && committed ? <p className="text-[13px] font-medium text-up">{t("jury.sealed", { vote: myVote === undefined ? "?" : t(myVote ? "jury.pass" : "jury.fail") })}</p> : null}
      {phase === "reveal" && committed && !revealed ? (
        <Button tone="gold" size="sm" disabled={tx.busy} onClick={reveal}>
          {t("jury.reveal")}
        </Button>
      ) : null}
      {phase === "reveal" && !committed ? <p className="text-[13px] text-muted">{t("jury.missedCommit")}</p> : null}
      {revealed ? <p className="text-[13px] font-medium text-up">{t("jury.revealed", { vote: t(ballot![2] ? "jury.pass" : "jury.fail") })}</p> : null}
      {phase === "finalize" ? (
        <Button tone="soft" size="sm" disabled={tx.busy} onClick={finalize}>
          {t("deal.act.finalize")}
        </Button>
      ) : null}
      {committed && phase === "commit" ? <p className="text-[12px] text-muted">{t("jury.revealReminder")}</p> : null}
      <TxNotice state={tx.state} onClose={tx.reset} />
    </Panel>
  );
}

function EvidenceBlock({ label, text, ok }: { label: string; text?: string | null; ok?: boolean }) {
  const { t } = useLocale();
  return (
    <div className="rounded-xl bg-card-2 px-3 py-2">
      <div className="flex justify-between gap-2 font-semibold">
        <span>{label}</span>
        {text != null ? <span className={ok ? "text-up" : "text-down"}>{ok ? t("jury.hashOk") : t("jury.hashBad")}</span> : null}
      </div>
      {text != null ? (
        <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sub">{text}</p>
      ) : (
        <p className="mt-1 text-muted">{t("jury.notPublished")}</p>
      )}
    </div>
  );
}
