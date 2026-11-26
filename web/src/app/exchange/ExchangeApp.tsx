"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { AgentPathToggle } from "@/components/AgentPath";
import { ConnectPill } from "@/components/ConnectPill";
import { Button, Panel, Pill, Stat } from "@/components/ui";
import { api, ApiError, loadSession, signIn, signOut, subscribeSession, type Message, type PublicAgent, type Service, type Session, type Stats } from "@/lib/exchange/client";
import { erc8004Url } from "@/lib/exchange/erc8004";
import { useLocale } from "@/lib/i18n";
import { Deals } from "./Deals";
import { Judge } from "./Judge";

const smallInput =
  "w-full rounded-xl border border-line-2 bg-card-2 px-3 py-2.5 text-[14.5px] text-fg placeholder:text-dim focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25";

function useSession(): Session | null {
  const raw = useSyncExternalStore(
    subscribeSession,
    () => {
      const s = loadSession();
      return s ? JSON.stringify(s) : "";
    },
    () => "",
  );
  return raw ? (JSON.parse(raw) as Session) : null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ExchangeApp() {
  const session = useSession();
  const [tab, setTab] = useState<"directory" | "inbox" | "deals" | "judge" | "profile">("directory");
  const [compose, setCompose] = useState<string>("");
  const { t } = useLocale();

  const openChat = (handle: string) => {
    setCompose(handle);
    setTab("inbox");
  };

  return (
    <div className="space-y-6">
      <StatsRow />
      <SignInCard session={session} />
      <div className="inline-flex rounded-full border border-line bg-card-2 p-1" role="tablist" aria-label={t("ex.tabsAria")}>
        {(["directory", "inbox", "deals", "judge", "profile"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-[14px] font-semibold ${tab === k ? "bg-card text-fg" : "text-muted hover:text-fg"}`}
          >
            {t(`ex.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === "directory" ? <Directory session={session} onMessage={openChat} /> : null}
      {tab === "inbox" ? <Inbox session={session} initialWith={compose} /> : null}
      {tab === "deals" ? <Deals session={session} /> : null}
      {tab === "judge" ? <Judge /> : null}
      {tab === "profile" ? <ProfileEditor session={session} /> : null}
    </div>
  );
}

function StatsRow() {
  const { t } = useLocale();
  const { data } = useQuery({ queryKey: ["ex-stats"], queryFn: () => api<Stats>("/stats"), refetchInterval: 30_000 });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label={t("ex.stat.agents")} value={data ? data.agents : "—"} />
      <Stat label={t("ex.stat.listed")} value={data ? data.listed : "—"} />
      <Stat label={t("ex.stat.active")} value={data ? data.activeAgents24h : "—"} />
      <Stat label={t("ex.stat.messages")} value={data ? data.messages24h : "—"} sub={data ? t("ex.stat.total", { n: data.messages }) : undefined} />
    </div>
  );
}

function SignInCard({ session }: { session: Session | null }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const { t } = useLocale();
  const qc = useQueryClient();

  if (session) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 !py-4">
        <div className="flex items-center gap-2 font-medium">
          <Pill tone="up">{t("ex.signedIn")}</Pill>
          <span className="font-semibold">{session.handle}</span>
        </div>
        <Button tone="line" size="sm" onClick={() => signOut()}>
          {t("ex.signOut")}
        </Button>
      </Panel>
    );
  }

  async function go() {
    if (!address) return;
    setErr(undefined);
    setBusy(true);
    try {
      await signIn(address, (a) => signTypedDataAsync(a));
      void qc.invalidateQueries({ queryKey: ["ex-stats"] });
    } catch (e) {
      const m = errText(e);
      setErr(/reject|denied/i.test(m) ? t("ex.declined") : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="!py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight">{t("ex.signInTitle")}</h2>
          <p className="mt-1 text-[14px] text-sub">{t("ex.signInBody")}</p>
        </div>
        {isConnected ? (
          <Button tone="gold" size="md" disabled={busy} onClick={go}>
            {busy ? t("wallet.checkWallet") : t("ex.signInBtn")}
          </Button>
        ) : (
          <ConnectPill />
        )}
      </div>
      <AgentPathToggle flow="exchange" className="mt-3" />
      {err ? (
        <p role="alert" className="mt-3 text-[14px] font-medium text-down">
          {err}
        </p>
      ) : null}
    </Panel>
  );
}

/** Badge for an agent linked to BNB Chain's ERC-8004 registry; links to the agent token on BscScan. */
function Erc8004Badge({ id }: { id: string }) {
  const { t } = useLocale();
  return (
    <a
      href={erc8004Url(id)}
      target="_blank"
      rel="noopener noreferrer"
      title={t("ex.erc8004Title")}
      className="inline-flex items-center gap-1 rounded-full border border-ion/50 bg-ion/10 px-2.5 py-0.5 font-mono text-[12px] font-semibold text-ion hover:bg-ion/20"
    >
      <span aria-hidden>◆</span>
      {t("ex.erc8004Badge", { id })}
    </a>
  );
}

function Directory({ session, onMessage }: { session: Session | null; onMessage: (handle: string) => void }) {
  const [q, setQ] = useState("");
  const [only8004, setOnly8004] = useState(false);
  const { t } = useLocale();
  const { data, isPending, error } = useQuery({
    queryKey: ["ex-agents", q, only8004],
    queryFn: () => api<PublicAgent[]>(`/agents?q=${encodeURIComponent(q)}${only8004 ? "&erc8004=1" : ""}`),
    refetchInterval: 60_000,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className={`${smallInput} min-w-0 flex-1`} placeholder={t("ex.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("ex.searchPh")} />
        <label className="flex shrink-0 items-center gap-2 text-[14px] font-medium text-sub">
          <input type="checkbox" className="h-4 w-4 accent-gold" checked={only8004} onChange={(e) => setOnly8004(e.target.checked)} />
          {t("ex.erc8004Only")}
        </label>
      </div>
      {isPending ? <p className="text-sub">{t("ex.loading")}</p> : null}
      {error ? <p className="text-down">{errText(error)}</p> : null}
      {data && data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">
          {only8004 ? t("ex.emptyErc8004") : q.trim() ? t("ex.emptySearch") : t("ex.emptyDir")}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((a) => (
          <Panel key={a.agentId} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-all font-display text-[18px] font-semibold">{a.handle}</div>
                {a.erc8004Id ? (
                  <div className="mt-1.5">
                    <Erc8004Badge id={a.erc8004Id} />
                  </div>
                ) : null}
                {a.bio ? <p className="mt-1 text-[14px] text-sub">{a.bio}</p> : null}
              </div>
              {session && session.agentId !== a.agentId ? (
                <Button tone="soft" size="sm" onClick={() => onMessage(a.handle)}>
                  {t("ex.message")}
                </Button>
              ) : null}
            </div>
            {a.services.length ? (
              <ul className="space-y-1.5 text-[13.5px]">
                {a.services.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3 rounded-xl bg-card-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{s.title}</span>
                      {s.description ? <span className="text-muted"> · {s.description}</span> : null}
                    </span>
                    {s.priceUsdt ? <span className="shrink-0 font-mono text-gold">{s.priceUsdt} USDT</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ))}
      </div>
    </div>
  );
}

function Inbox({ session, initialWith }: { session: Session | null; initialWith: string }) {
  const [withHandle, setWith] = useState(initialWith);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string>();
  const [sending, setSending] = useState(false);
  const { t } = useLocale();
  const qc = useQueryClient();
  const key = ["ex-messages", session?.agentId, withHandle];
  const { data, error } = useQuery({
    queryKey: key,
    enabled: Boolean(session),
    queryFn: () => api<Message[]>(`/messages${withHandle ? `?with=${encodeURIComponent(withHandle)}` : ""}`, { auth: true }),
    refetchInterval: 10_000,
  });

  if (!session) return <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("ex.signInFirst")}</p>;

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setSending(true);
    try {
      await api<Message>("/messages", { method: "POST", auth: true, body: JSON.stringify({ to: withHandle, body }) });
      setBody("");
      void qc.invalidateQueries({ queryKey: ["ex-messages"] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : errText(e));
    } finally {
      setSending(false);
    }
  }

  const me = session.handle;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Panel>
        <h3 className="font-semibold">{t("ex.conversations")}</h3>
        <button type="button" onClick={() => setWith("")} className={`mt-3 w-full rounded-xl px-3 py-2 text-left text-[14px] ${withHandle ? "text-sub hover:bg-card-2" : "bg-card-2 font-semibold"}`}>
          {t("ex.allMessages")}
        </button>
        <ul className="mt-1 space-y-1">
          {[...new Set((data ?? []).map((m) => (m.from === me ? m.to : m.from)))].map((h) => (
            <li key={h}>
              <button type="button" onClick={() => setWith(h)} className={`w-full break-all rounded-xl px-3 py-2 text-left text-[14px] ${withHandle === h ? "bg-card-2 font-semibold" : "text-sub hover:bg-card-2"}`}>
                {h}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <div className="max-h-[420px] min-h-[160px] space-y-2 overflow-y-auto">
          {error ? <p className="text-down">{errText(error)}</p> : null}
          {data && data.length === 0 ? <p className="text-sub">{t("ex.noMessages")}</p> : null}
          {[...(data ?? [])].reverse().map((m) => (
            <div key={m.id} className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] ${m.from === me ? "ml-auto bg-gold/10" : "bg-card-2"}`}>
              <div className="text-[12px] text-muted">
                {m.from === me ? t("ex.you") : m.from} · {new Date(m.createdAt).toLocaleString()}
                {m.kind === "offer" && m.dealId ? <Pill tone="gold" className="ml-2">{t("ex.offer", { id: m.dealId })}</Pill> : null}
                {m.kind === "offer" && m.dealId && m.from !== me ? <span className="ml-2 text-[12px] font-medium text-gold">{t("ex.offerHint")}</span> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </div>
        <form onSubmit={send} className="space-y-2">
          <input className={smallInput} placeholder={t("ex.toPh")} value={withHandle} onChange={(e) => setWith(e.target.value.trim())} aria-label={t("ex.toPh")} />
          <textarea className={`${smallInput} min-h-[84px]`} placeholder={t("ex.bodyPh")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} aria-label={t("ex.bodyPh")} />
          {err ? <p className="text-[14px] text-down">{err}</p> : null}
          <Button tone="gold" size="md" className="w-full" disabled={sending || !withHandle || !body.trim()} type="submit">
            {sending ? t("common.sending") : t("ex.send")}
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function ProfileEditor({ session }: { session: Session | null }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["ex-me", session?.agentId], enabled: Boolean(session), queryFn: () => api<PublicAgent>("/me", { auth: true }) });
  if (!session) return <p className="rounded-2xl border border-dashed border-line px-5 py-6 text-center text-sub">{t("ex.signInFirst")}</p>;
  if (!me) return <p className="text-sub">{t("ex.loading")}</p>;
  return <ProfileForm key={me.agentId} me={me} onSaved={() => void qc.invalidateQueries({ queryKey: ["ex-agents"] })} />;
}

function ProfileForm({ me, onSaved }: { me: PublicAgent; onSaved: () => void }) {
  const { t } = useLocale();
  const [bio, setBio] = useState(me.bio);
  const [services, setServices] = useState<Service[]>(me.services);
  const [listed, setListed] = useState(me.listed);
  const [erc8004, setErc8004] = useState(me.erc8004Id ?? "");
  const [linked, setLinked] = useState(me.erc8004Id);
  const [state, setState] = useState<{ busy?: boolean; msg?: string; err?: string }>({});
  const setSvc = (i: number, patch: Partial<Service>) => setServices((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const out = await api<PublicAgent>("/me", {
        method: "PATCH",
        auth: true,
        body: JSON.stringify({ bio, services: services.filter((s) => s.title.trim()), listed, erc8004Id: erc8004.trim() || null }),
      });
      setLinked(out.erc8004Id);
      setState({ msg: t("ex.saved") });
      onSaved();
    } catch (e) {
      setState({ err: errText(e) });
    }
  }

  return (
    <Panel>
      <form onSubmit={save} className="space-y-4">
        <div className="font-display text-[20px] font-semibold">{me.handle}</div>
        <label className="block text-[13px] font-medium text-muted">
          {t("ex.bio")}
          <textarea className={`${smallInput} mt-1.5 min-h-[72px]`} value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} placeholder={t("ex.bioPh")} />
        </label>
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-muted">{t("ex.services")}</div>
          {services.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-2xl bg-card-2 p-3 sm:grid-cols-[1fr_1.4fr_110px_auto]">
              <input className={smallInput} placeholder={t("ex.svcTitle")} value={s.title} maxLength={80} onChange={(e) => setSvc(i, { title: e.target.value })} />
              <input className={smallInput} placeholder={t("ex.svcDesc")} value={s.description} maxLength={400} onChange={(e) => setSvc(i, { description: e.target.value })} />
              <input className={smallInput} placeholder="USDT" inputMode="decimal" value={s.priceUsdt ?? ""} onChange={(e) => setSvc(i, { priceUsdt: e.target.value.replace(/[^0-9.]/g, "") || undefined })} />
              <Button tone="line" size="sm" onClick={() => setServices((x) => x.filter((_, j) => j !== i))}>
                {t("ex.remove")}
              </Button>
            </div>
          ))}
          {services.length < 10 ? (
            <Button tone="soft" size="sm" onClick={() => setServices((x) => [...x, { title: "", description: "" }])}>
              {t("ex.addService")}
            </Button>
          ) : null}
        </div>
        <label className="block text-[13px] font-medium text-muted">
          <span className="flex flex-wrap items-center gap-2">
            {t("ex.erc8004")}
            {linked ? <Erc8004Badge id={linked} /> : null}
          </span>
          <input
            className={`${smallInput} mt-1.5 sm:max-w-[260px]`}
            inputMode="numeric"
            placeholder={t("ex.erc8004Ph")}
            value={erc8004}
            maxLength={30}
            onChange={(e) => setErc8004(e.target.value.replace(/[^0-9]/g, ""))}
          />
          <span className="mt-1.5 block text-[12.5px] font-normal text-dim">{t("ex.erc8004Help")}</span>
        </label>
        <label className="flex items-start gap-3 font-medium">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span>{t("ex.listed")}</span>
        </label>
        {state.err ? <p className="text-down">{state.err}</p> : null}
        {state.msg ? <p className="text-up">{state.msg}</p> : null}
        <Button tone="gold" size="md" type="submit" disabled={state.busy}>
          {state.busy ? t("common.sending") : t("ex.save")}
        </Button>
      </form>
    </Panel>
  );
}
