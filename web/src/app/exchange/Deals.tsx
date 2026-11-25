"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { zeroAddress, type Address } from "viem";
import { useConfig, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { readContract } from "wagmi/actions";
import { agentDealsV2Abi, agentIdAbi, towackTokenAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { AddressLink, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Panel, Pill, type PillTone } from "@/components/ui";
import {
  agentIdOfHandle,
  availableActions,
  bareHandle,
  COMMIT_WINDOW,
  JURY_TIME,
  juryPhase,
  MAX_WINDOW,
  MIN_WINDOW,
  parseTokenAmount,
  payoutSplit,
  roleOf,
  scanIds,
  textHash,
  toDeal,
  toJury,
  WINDOW_PRESETS,
  type Deal,
  type DealAction,
  type DealTuple,
  type Jury,
  type JuryTuple,
  type Role,
} from "@/lib/deals";
import { api, type Message, type Session } from "@/lib/exchange/client";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/translate";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

export const input =
  "w-full rounded-xl border border-line-2 bg-card-2 px-3 py-2.5 text-[14.5px] text-fg placeholder:text-dim focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25";

export const STATUS_TONE: Record<Deal["status"], PillTone> = {
  none: "line",
  open: "gold",
  funded: "up",
  delivered: "up",
  paid: "neutral",
  refunded: "line",
  cancelled: "line",
};

export type EvidenceRow = { dealId: string; terms: string | null; delivery: string | null };

/** Publish a deal's terms / delivery text for judges (stored only if it matches the on-chain hash). */
export async function publishEvidence(dealId: bigint, body: { terms?: string; delivery?: string }) {
  return api<EvidenceRow>("/evidence", { method: "POST", auth: true, body: JSON.stringify({ dealId: String(dealId), ...body }) });
}

/** Deals tab: AgentDealsV2 escrow between two Agent IDs, judged by open Agent ID juries. */
export function Deals({ session }: { session: Session | null }) {
  const { t } = useLocale();
  const { addresses } = useTowack();
  if (!addresses.agentDealsV2) return <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("deal.notDeployed")}</p>;
  return (
    <div className="space-y-4">
      <Panel tone="flat" className="!py-4 text-[14px] text-sub">
        <p>{t("deal.how")}</p>
        <p className="mt-2 font-medium text-fg">{t("deal.risk")}</p>
        <p className="mt-2 text-[13px]">
          {t("deal.contract")} <AddressLink address={addresses.agentDealsV2} />
        </p>
      </Panel>
      <NeedsWallet>
        <DealsLive session={session} deals={addresses.agentDealsV2} />
      </NeedsWallet>
      <AgentPathToggle flow="deals" />
    </div>
  );
}

function DealsLive({ session, deals }: { session: Session | null; deals: Address }) {
  const { t } = useLocale();
  const { chainId, account, addresses } = useTowack();
  const c = { address: deals, abi: agentDealsV2Abi, chainId } as const;

  const { data: base, refetch: refetchBase } = useReadContracts({
    contracts: [
      { ...c, functionName: "dealCount" },
      { ...c, functionName: "twak" },
      { ...c, functionName: "usdt" },
      { address: addresses.agentId, abi: agentIdAbi, functionName: "handleOf", args: account ? [account] : undefined, chainId },
    ],
    query: { refetchInterval: 20_000 },
  });
  const dealCount = base?.[0]?.result as bigint | undefined;
  const twak = base?.[1]?.result as Address | undefined;
  const usdt = base?.[2]?.result as Address | undefined;
  // "" = this wallet has no Agent ID (handleOf returns empty or reverts); undefined = still loading.
  const h = base?.[3];
  const myHandle = !h ? undefined : h.status === "success" ? (h.result as string) : "";
  const myAgentId = myHandle ? agentIdOfHandle(myHandle) : undefined;

  const ids = useMemo(() => (dealCount ? scanIds(dealCount) : []), [dealCount]);
  const { data: rows, refetch: refetchRows } = useReadContracts({
    contracts: ids.map((id) => ({ ...c, functionName: "deals" as const, args: [id] as const })),
    query: { enabled: ids.length > 0, refetchInterval: 20_000 },
  });
  const mine = useMemo(() => {
    const out: { deal: Deal; role: Role }[] = [];
    rows?.forEach((r, i) => {
      if (r.status !== "success") return;
      const deal = toDeal(ids[i], r.result as unknown as DealTuple);
      const role = roleOf(deal, account, myAgentId);
      if (role !== "none") out.push({ deal, role });
    });
    return out;
  }, [rows, ids, account, myAgentId]);

  const { data: juries } = useReadContracts({
    contracts: mine.map((m) => ({ ...c, functionName: "juries" as const, args: [m.deal.id] as const })),
    query: { enabled: mine.length > 0, refetchInterval: 20_000 },
  });

  // Counterpart handles: provider/client wallets → handleOf (address → handle only; the page never shows a handle's wallet).
  const openClientIds = mine.filter((m) => m.deal.status === "open" && m.role === "provider").map((m) => m.deal.clientAgentId);
  const { data: owners } = useReadContracts({
    contracts: openClientIds.map((id) => ({ address: addresses.agentId, abi: agentIdAbi, functionName: "ownerOf" as const, args: [id] as const, chainId })),
    query: { enabled: openClientIds.length > 0 },
  });
  const ownerOfClient = new Map<bigint, Address>();
  owners?.forEach((o, i) => o.status === "success" && ownerOfClient.set(openClientIds[i], o.result as Address));
  const wallets = [...new Set(mine.flatMap((m) => [m.deal.provider, m.deal.client !== zeroAddress ? m.deal.client : ownerOfClient.get(m.deal.clientAgentId)]).filter(Boolean) as Address[])];
  const { data: handles } = useReadContracts({
    contracts: wallets.map((w) => ({ address: addresses.agentId, abi: agentIdAbi, functionName: "handleOf" as const, args: [w] as const, chainId })),
    query: { enabled: wallets.length > 0 },
  });
  const handleOf = (w?: Address) => {
    if (!w) return undefined;
    const i = wallets.indexOf(w);
    const hh = i >= 0 ? (handles?.[i]?.result as string | undefined) : undefined;
    return hh ? `${hh}.ai` : undefined;
  };

  // Offer messages (terms text) from the Exchange inbox, to check against the on-chain termsHash.
  const { data: msgs } = useQuery({
    queryKey: ["ex-messages", session?.agentId, "deals"],
    enabled: Boolean(session),
    queryFn: () => api<Message[]>("/messages", { auth: true }),
    refetchInterval: 30_000,
  });
  const offerText = new Map<string, string>();
  msgs?.forEach((m) => m.kind === "offer" && m.dealId && !offerText.has(m.dealId) && offerText.set(m.dealId, m.body));

  // Public judge evidence for my deals.
  const idsParam = mine.map((m) => String(m.deal.id)).join(",");
  const { data: evidence, refetch: refetchEvidence } = useQuery({
    queryKey: ["ex-evidence", idsParam],
    enabled: idsParam.length > 0,
    queryFn: () => api<EvidenceRow[]>(`/evidence?ids=${idsParam}`),
    refetchInterval: 60_000,
  });
  const evidenceOf = new Map((evidence ?? []).map((e) => [e.dealId, e]));

  const refresh = () => {
    void refetchBase();
    void refetchRows();
    void refetchEvidence();
  };

  return (
    <div className="space-y-4">
      {myHandle === "" ? <p className="rounded-2xl border border-line bg-gold/5 px-4 py-3 text-[14px] font-medium">{t("deal.noAgentId")}</p> : null}
      {myHandle ? <CreateOffer deals={deals} twak={twak} usdt={usdt} myHandle={myHandle} session={session} onDone={refresh} /> : null}
      <h3 className="pt-2 font-semibold">{t("deal.mine")}</h3>
      {dealCount !== undefined && mine.length === 0 ? <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("deal.none")}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map(({ deal, role }, i) => {
          const key = String(deal.id);
          const terms = offerText.get(key) ?? evidenceOf.get(key)?.terms ?? undefined;
          return (
            <DealCard
              key={key}
              deal={deal}
              role={role}
              jury={toJury(juries?.[i]?.result as JuryTuple | undefined)}
              deals={deals}
              isTwak={Boolean(twak && deal.token.toLowerCase() === twak.toLowerCase())}
              counterpart={role === "provider" ? handleOf(deal.client !== zeroAddress ? deal.client : ownerOfClient.get(deal.clientAgentId)) : handleOf(deal.provider)}
              terms={terms}
              evidence={evidenceOf.get(key)}
              session={session}
              onDone={refresh}
            />
          );
        })}
      </div>
    </div>
  );
}

function CreateOffer({
  deals,
  twak,
  usdt,
  myHandle,
  session,
  onDone,
}: {
  deals: Address;
  twak?: Address;
  usdt?: Address;
  myHandle: string;
  session: Session | null;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const { chainId, addresses, account } = useTowack();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState("");
  const [token, setToken] = useState<"USDT" | "TWAK">("USDT");
  const [amount, setAmount] = useState("");
  const [window_, setWindow] = useState<number>(WINDOW_PRESETS[3].seconds);
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState<{ tone: "up" | "down"; text: string }>();

  const clientBare = bareHandle(client);
  const clientId = clientBare ? agentIdOfHandle(clientBare) : undefined;
  // Existence check only (ownerOf reverts for unknown handles). The owner address is never displayed.
  const { data: clientOwner, isError: clientMissing, isFetching } = useReadContract({
    address: addresses.agentId,
    abi: agentIdAbi,
    functionName: "ownerOf",
    args: clientId !== undefined ? [clientId] : undefined,
    chainId,
    query: { enabled: clientId !== undefined, retry: false },
  });
  const self = clientBare && clientBare === bareHandle(myHandle);
  const clientOk = Boolean(clientOwner) && !clientMissing && !self && clientOwner?.toLowerCase() !== account?.toLowerCase();
  const amountWei = parseTokenAmount(amount);
  const tokenAddr = token === "TWAK" ? twak : usdt;
  const split = amountWei ? payoutSplit(token === "TWAK", amountWei, 1) : undefined;
  const canSubmit = Boolean(clientOk && amountWei && tokenAddr && terms.trim() && window_ >= MIN_WINDOW && window_ <= MAX_WINDOW && !tx.busy);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !amountWei || !tokenAddr || clientId === undefined) return;
    setNote(undefined);
    const termsText = terms.trim();
    const termsHash = textHash(termsText);
    const ok = await tx.run(t("deal.txCreate"), () =>
      writeContractAsync({ address: deals, abi: agentDealsV2Abi, functionName: "createOffer", args: [tokenAddr, amountWei, clientId, BigInt(window_), termsHash], chainId }),
    );
    if (!ok) return;
    onDone();
    // Find the new deal id (newest deal by this wallet with these terms), then publish + message the terms.
    let dealId: bigint | undefined;
    try {
      const n = await readContract(config, { address: deals, abi: agentDealsV2Abi, functionName: "dealCount", chainId });
      for (let i = n; i >= 1n && i > n - 20n; i--) {
        const d = (await readContract(config, { address: deals, abi: agentDealsV2Abi, functionName: "deals", args: [i], chainId })) as unknown as DealTuple;
        if (d[0].toLowerCase() === account?.toLowerCase() && d[5] === termsHash) {
          dealId = i;
          break;
        }
      }
    } catch {
      /* the offer is on-chain either way */
    }
    if (dealId !== undefined && session) {
      try {
        await publishEvidence(dealId, { terms: termsText });
        await api("/messages", { method: "POST", auth: true, body: JSON.stringify({ to: `${clientBare}.ai`, body: termsText, kind: "offer", dealId: String(dealId) }) });
        setNote({ tone: "up", text: t("deal.sentOffer", { id: String(dealId), handle: `${clientBare}.ai` }) });
      } catch (err) {
        setNote({ tone: "down", text: t("deal.sendFailed", { id: String(dealId), err: err instanceof Error ? err.message : String(err) }) });
      }
      onDone();
    } else if (dealId !== undefined) {
      setNote({ tone: "down", text: t("deal.tellClient", { id: String(dealId) }) });
    }
    setAmount("");
    setTerms("");
  }

  if (!open) {
    return (
      <Button tone="gold" size="md" onClick={() => setOpen(true)}>
        {t("deal.new")}
      </Button>
    );
  }

  return (
    <Panel>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">{t("deal.newTitle")}</h3>
          <button type="button" className="text-[13px] font-semibold text-muted hover:text-fg" onClick={() => setOpen(false)}>
            {t("deal.close")}
          </button>
        </div>
        <label className="block text-[13px] font-medium text-muted">
          {t("deal.client")}
          <input className={`${input} mt-1.5`} placeholder="name.ai" value={client} onChange={(e) => setClient(e.target.value)} autoComplete="off" />
          {clientBare && !isFetching ? (
            <span className={`mt-1 block text-[12.5px] ${clientOk ? "text-up" : "text-down"}`}>
              {self ? t("deal.selfDeal") : clientOk ? t("deal.clientOk", { handle: `${clientBare}.ai` }) : t("deal.clientMissing")}
            </span>
          ) : null}
        </label>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <label className="block text-[13px] font-medium text-muted">
            {t("deal.token")}
            <select className={`${input} mt-1.5`} value={token} onChange={(e) => setToken(e.target.value as "USDT" | "TWAK")}>
              <option value="USDT">USDT</option>
              <option value="TWAK">TWAK</option>
            </select>
          </label>
          <label className="block text-[13px] font-medium text-muted">
            {t("deal.amount")}
            <input className={`${input} mt-1.5`} inputMode="decimal" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
        </div>
        {split ? (
          <p className="text-[12.5px] text-muted">
            {t("deal.splitPreview", { you: fmt18(split.toProvider), fee: fmt18(split.fee), judges: fmt18(split.toJudges), token })}
          </p>
        ) : null}
        <label className="block text-[13px] font-medium text-muted">
          {t("deal.window")}
          <select className={`${input} mt-1.5`} value={window_} onChange={(e) => setWindow(Number(e.target.value))}>
            {WINDOW_PRESETS.map((p) => (
              <option key={p.key} value={p.seconds}>
                {fmtDuration(p.seconds)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] font-medium text-muted">
          {t("deal.terms")}
          <textarea className={`${input} mt-1.5 min-h-[96px]`} maxLength={2000} placeholder={t("deal.termsPh")} value={terms} onChange={(e) => setTerms(e.target.value)} />
          <span className="mt-1 block text-[12px]">{session ? t("deal.termsNote") : t("deal.termsNoteSignedOut")}</span>
        </label>
        <Button tone="gold" size="md" type="submit" className="w-full" disabled={!canSubmit}>
          {tx.busy ? t("wallet.checkWallet") : t("deal.create")}
        </Button>
        <TxNotice state={tx.state} onClose={tx.reset} />
        {note ? <p className={`text-[14px] font-medium ${note.tone === "up" ? "text-up" : "text-down"}`}>{note.text}</p> : null}
      </form>
    </Panel>
  );
}

function DealCard({
  deal,
  role,
  jury,
  deals,
  isTwak,
  counterpart,
  terms,
  evidence,
  session,
  onDone,
}: {
  deal: Deal;
  role: Role;
  jury: Jury;
  deals: Address;
  isTwak: boolean;
  counterpart?: string;
  terms?: string;
  evidence?: EvidenceRow;
  session: Session | null;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const { chainId, account } = useTowack();
  const now = useNow(15_000);
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [confirm, setConfirm] = useState<DealAction>();
  const [delivery, setDelivery] = useState("");
  const [pubErr, setPubErr] = useState<string>();
  const sym = isTwak ? "TWAK" : "USDT";
  const split = payoutSplit(isTwak, deal.amount, 1);
  const actions = now > 0 ? availableActions(deal, role, now) : [];
  const phase = now > 0 ? juryPhase(deal, now) : "none";
  const c = { address: deals, abi: agentDealsV2Abi, chainId } as const;

  // Client side of an open offer: balance + allowance for the exact approve → accept.
  const needFunds = role === "client" && deal.status === "open";
  const { data: funds } = useReadContracts({
    contracts: [
      { address: deal.token, abi: towackTokenAbi, functionName: "balanceOf", args: account ? [account] : undefined, chainId },
      { address: deal.token, abi: towackTokenAbi, functionName: "allowance", args: account ? [account, deals] : undefined, chainId },
    ],
    query: { enabled: needFunds && Boolean(account), refetchInterval: 15_000 },
  });
  const balance = funds?.[0]?.result as bigint | undefined;
  const allowance = (funds?.[1]?.result as bigint | undefined) ?? 0n;
  const short = needFunds && balance !== undefined && balance < deal.amount;

  const termsOk = terms !== undefined ? textHash(terms) === deal.termsHash : undefined;
  const needsTermsPublished = Boolean(session && terms && termsOk && !evidence?.terms && deal.status !== "cancelled");

  async function publishTerms() {
    if (!terms) return;
    setPubErr(undefined);
    try {
      await publishEvidence(deal.id, { terms });
      onDone();
    } catch (e) {
      setPubErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function act(a: DealAction) {
    setConfirm(undefined);
    const id = deal.id;
    let ok = false;
    switch (a) {
      case "accept":
        if (allowance < deal.amount) {
          ok = await tx.run(t("deal.txApprove", { token: sym }), () =>
            writeContractAsync({ address: deal.token, abi: towackTokenAbi, functionName: "approve", args: [deals, deal.amount], chainId }),
          );
          if (!ok) return;
        }
        ok = await tx.run(t("deal.act.accept"), () => writeContractAsync({ ...c, functionName: "accept", args: [id] }));
        break;
      case "deliver": {
        const text = delivery.trim();
        ok = await tx.run(t("deal.act.deliver"), () => writeContractAsync({ ...c, functionName: "deliver", args: [id, textHash(text)] }));
        if (ok && session) {
          await publishEvidence(id, { delivery: text }).catch((e) => setPubErr(e instanceof Error ? e.message : String(e)));
          if (counterpart) {
            await api("/messages", { method: "POST", auth: true, body: JSON.stringify({ to: counterpart, body: t("deal.deliveredMsg", { id: String(id), note: text }) }) }).catch(() => undefined);
          }
        }
        if (ok) setDelivery("");
        break;
      }
      case "cancel":
        ok = await tx.run(t("deal.act.cancel"), () => writeContractAsync({ ...c, functionName: "cancelOffer", args: [id] }));
        break;
      case "release":
        ok = await tx.run(t("deal.act.release"), () => writeContractAsync({ ...c, functionName: "release", args: [id] }));
        break;
      case "finalize":
        ok = await tx.run(t("deal.act.finalize"), () => writeContractAsync({ ...c, functionName: "finalize", args: [id] }));
        break;
      case "refundByProvider":
        ok = await tx.run(t("deal.act.refundByProvider"), () => writeContractAsync({ ...c, functionName: "refundByProvider", args: [id] }));
        break;
      case "refund":
        ok = await tx.run(t("deal.act.refund"), () => writeContractAsync({ ...c, functionName: "refund", args: [id] }));
        break;
    }
    if (ok) onDone();
  }

  // Final, money-moving steps ask twice in the page before opening the wallet.
  const needsConfirm = (a: DealAction) => a === "release" || a === "refundByProvider" || a === "accept";

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-display text-[18px] font-semibold">{t("deal.title", { id: String(deal.id) })}</div>
          <div className="text-[13px] text-muted">{t(role === "provider" ? "deal.youProvide" : "deal.youPay", { handle: counterpart ?? t("deal.unknownAgent") })}</div>
        </div>
        <Pill tone={STATUS_TONE[deal.status]}>{t(`deal.status.${deal.status}` as MessageKey)}</Pill>
      </div>
      <div className="font-mono text-[22px] font-medium">
        {fmt18(deal.amount)} <span className="text-[15px] text-muted">{sym}</span>
      </div>
      <p className="text-[12.5px] text-muted">
        {t(isTwak ? "deal.feeTwak" : "deal.feeUsdt", { you: fmt18(split.toProvider), fee: fmt18(split.fee), judges: fmt18(split.toJudges), token: sym })}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">{t("deal.windowLabel")}</dt>
        <dd>{fmtDuration(deal.deliveryWindow)}</dd>
        {deal.deadline ? (
          <>
            <dt className="text-muted">{t("deal.deadline")}</dt>
            <dd>{fmtDate(deal.deadline)}</dd>
          </>
        ) : null}
        {deal.deliveredAt ? (
          <>
            <dt className="text-muted">{t("deal.deliveredAt")}</dt>
            <dd>{fmtDate(deal.deliveredAt)}</dd>
          </>
        ) : null}
      </dl>

      {deal.status === "delivered" || jury.verdict !== "none" ? <JuryBox deal={deal} jury={jury} phase={phase} /> : null}

      {terms !== undefined ? (
        <div className="rounded-xl bg-card-2 px-3 py-2 text-[13px]">
          <div className={`font-semibold ${termsOk ? "text-up" : "text-down"}`}>{termsOk ? t("deal.termsMatch") : t("deal.termsMismatch")}</div>
          <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sub">{terms}</p>
        </div>
      ) : deal.status === "open" && role === "client" ? (
        <p className="rounded-xl bg-gold/5 px-3 py-2 text-[13px]">{t("deal.termsUnknown")}</p>
      ) : null}
      {needsTermsPublished ? (
        <Button tone="soft" size="sm" onClick={publishTerms}>
          {t("deal.publishTerms")}
        </Button>
      ) : null}
      {deal.status === "delivered" && !evidence?.delivery ? <p className="text-[12.5px] text-down">{t("deal.noDeliveryEvidence")}</p> : null}
      {pubErr ? <p className="text-[12.5px] text-down">{pubErr}</p> : null}

      {actions.includes("deliver") ? (
        <>
          <textarea className={`${input} min-h-[64px]`} maxLength={4000} placeholder={t("deal.deliveryPh")} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          {!session ? <p className="text-[12.5px] text-down">{t("deal.signInToDeliver")}</p> : null}
        </>
      ) : null}
      {short ? <p className="text-[13px] text-down">{t("deal.short", { token: sym })}</p> : null}

      {actions.length ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) =>
            confirm === a ? (
              <Button key={a} tone={a === "refundByProvider" ? "danger" : "gold"} size="sm" disabled={tx.busy} onClick={() => act(a)}>
                {t(`deal.confirm.${a}` as MessageKey, { amount: fmt18(deal.amount), token: sym })}
              </Button>
            ) : (
              <Button
                key={a}
                tone={a === "accept" || a === "release" || a === "finalize" || a === "deliver" ? "gold" : "line"}
                size="sm"
                disabled={tx.busy || (a === "deliver" && (!delivery.trim() || !session)) || (a === "accept" && (short || balance === undefined))}
                onClick={() => (needsConfirm(a) ? setConfirm(a) : act(a))}
              >
                {a === "accept" && allowance < deal.amount ? t("deal.act.approveAccept", { token: sym }) : t(`deal.act.${a}` as MessageKey)}
              </Button>
            ),
          )}
          {confirm ? (
            <Button tone="line" size="sm" onClick={() => setConfirm(undefined)}>
              {t("deal.back")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirm ? <p className="text-[12.5px] font-medium text-fg">{t(`deal.warn.${confirm}` as MessageKey)}</p> : null}
      <TxNotice state={tx.state} onClose={tx.reset} />
    </Panel>
  );
}

/** Jury status for a delivered (or jury-settled) deal. */
export function JuryBox({ deal, jury, phase }: { deal: Deal; jury: Jury; phase: ReturnType<typeof juryPhase> }) {
  const { t } = useLocale();
  const commitEnd = deal.deliveredAt + COMMIT_WINDOW;
  const revealEnd = deal.deliveredAt + JURY_TIME;
  return (
    <div className="rounded-xl border border-line px-3 py-2 text-[13px]">
      <div className="font-semibold">
        {jury.verdict !== "none"
          ? t(jury.verdict === "pass" ? "jury.verdictPass" : "jury.verdictFail", { pass: jury.passVotes, fail: jury.failVotes })
          : t(`jury.phase.${phase}` as MessageKey)}
      </div>
      {jury.verdict === "none" ? (
        <div className="mt-1 text-muted">
          {phase === "commit" ? t("jury.commitUntil", { at: fmtDate(commitEnd), n: jury.commits }) : null}
          {phase === "reveal" ? t("jury.revealUntil", { at: fmtDate(revealEnd), pass: jury.passVotes, fail: jury.failVotes, n: jury.commits }) : null}
          {phase === "finalize" ? t("jury.readyToFinalize", { pass: jury.passVotes, fail: jury.failVotes }) : null}
        </div>
      ) : null}
    </div>
  );
}
