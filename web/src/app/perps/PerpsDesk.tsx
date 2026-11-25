"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReadContract } from "wagmi";
import { agentIdAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { ConnectPill } from "@/components/ConnectPill";
import { RiskLine } from "@/components/RiskNote";
import { Panel, Pill } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { useLocale } from "@/lib/i18n";
import { ASTER_APP_URL, fetchMarkets, trimDecimal, type AsterNet, type MarketRow } from "@/lib/aster/markets";
import {
  fetchDepth,
  fetchTrades,
  mergeTrades,
  parseDepth,
  parseKlineEvent,
  parseMarkEvent,
  parseTickerEvent,
  parseTrades,
  terminalStreams,
  type Book,
  type Candle,
  type ChartInterval,
  type Trade,
} from "@/lib/aster/marketData";
import type { PerpsAgentIntent } from "@/lib/aster/instruction";
import { floorToStep, hasLimitPrice, hasStopPrice, isMarketExec } from "@/lib/aster/orders";
import { AsterAccountCard, useAsterAgent } from "./AsterAccount";
import { Blotter } from "./Blotter";
import { BookTrades } from "./BookTrades";
import { MarketHeader } from "./MarketHeader";
import { EMPTY_FORM, OrderTicket, parseLeverage, type OrderForm } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { useAsterStream } from "./useAsterStream";

type Live = { key: string; book?: Book; trades: Trade[]; mark?: ReturnType<typeof parseMarkEvent>; ticker?: ReturnType<typeof parseTickerEvent> };

export function PerpsDesk() {
  // Aster mainnet only.
  const net: AsterNet = "mainnet";
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIv] = useState<ChartInterval>("15m");
  const [form, setForm] = useState<OrderForm>(EMPTY_FORM);
  const [sheet, setSheet] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const agent = useAsterAgent(net);
  const { t } = useLocale();
  const key = `${net}|${symbol}`;

  const markets = useQuery({
    queryKey: ["aster-markets", net],
    queryFn: ({ signal }) => fetchMarkets(net, signal),
    refetchInterval: 15_000,
  });
  const rules = markets.data?.rules.get(symbol);
  const baseRow = markets.data?.rows.find((r) => r.symbol === symbol);

  // ---- live feed: one combined websocket for candles, book, trades, mark and ticker ----
  const names = useMemo(() => terminalStreams(symbol, interval), [symbol, interval]);
  const streams = useMemo(() => [names.kline, names.depth, names.trades, names.mark, names.ticker], [names]);
  const klineSubs = useRef(new Set<(c: Candle) => void>());
  const subscribe = useCallback((cb: (c: Candle) => void) => {
    klineSubs.current.add(cb);
    return () => {
      klineSubs.current.delete(cb);
    };
  }, []);
  const [live, setLive] = useState<Live>({ key: "", trades: [] });
  const pending = useRef<Live>({ key: "", trades: [] });
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onMessage = (stream: string, data: unknown) => {
    if (stream === names.kline) {
      const c = parseKlineEvent(data, interval);
      if (c) klineSubs.current.forEach((f) => f(c));
      return;
    }
    const p = pending.current.key === key ? pending.current : (pending.current = { key, trades: [] });
    if (stream === names.depth) p.book = parseDepth(data);
    else if (stream === names.trades) p.trades = mergeTrades(p.trades, parseTrades(data));
    else if (stream === names.mark) p.mark = parseMarkEvent(data) ?? p.mark;
    else if (stream === names.ticker) p.ticker = parseTickerEvent(data) ?? p.ticker;
    // Throttle React updates to ~4/s; data is never altered, only batched.
    if (!flushTimer.current) {
      flushTimer.current = setTimeout(() => {
        flushTimer.current = undefined;
        const batch = pending.current;
        pending.current = { key: batch.key, trades: [], mark: batch.mark, ticker: batch.ticker };
        setLive((prev) => {
          const b = prev.key === batch.key ? prev : { key: batch.key, trades: [] };
          return { key: batch.key, book: batch.book ?? b.book, trades: mergeTrades(b.trades, batch.trades), mark: batch.mark ?? b.mark, ticker: batch.ticker ?? b.ticker };
        });
      }, 250);
    }
  };
  useEffect(() => () => clearTimeout(flushTimer.current), []);
  const { status } = useAsterStream(net, streams, onMessage);
  const fresh = live.key === key ? live : undefined;

  // REST snapshots: first paint, and the fallback when the websocket is unavailable.
  const depth = useQuery({
    queryKey: ["aster-depth", net, symbol],
    queryFn: ({ signal }) => fetchDepth(net, symbol, 20, signal),
    refetchInterval: status === "poll" ? 3_000 : 30_000,
  });
  const restTrades = useQuery({
    queryKey: ["aster-trades", net, symbol],
    queryFn: ({ signal }) => fetchTrades(net, symbol, 50, signal),
    refetchInterval: status === "poll" ? 3_000 : 60_000,
  });
  const book = fresh?.book ?? depth.data;
  const trades = restTrades.data ? mergeTrades(fresh?.trades ?? [], restTrades.data) : fresh?.trades.length ? fresh.trades : undefined;

  const row: MarketRow | undefined = baseRow
    ? {
        ...baseRow,
        ...(fresh?.ticker?.lastPrice ? { lastPrice: fresh.ticker.lastPrice } : {}),
        ...(fresh?.ticker?.changePct !== undefined ? { changePct: fresh.ticker.changePct } : {}),
        ...(fresh?.ticker?.quoteVolume !== undefined ? { quoteVolume: fresh.ticker.quoteVolume } : {}),
        ...(fresh?.mark?.markPrice ? { markPrice: fresh.mark.markPrice } : {}),
        ...(fresh?.mark?.indexPrice ? { indexPrice: fresh.mark.indexPrice } : {}),
        ...(fresh?.mark?.fundingRate !== undefined ? { fundingRate: fresh.mark.fundingRate } : {}),
        ...(fresh?.mark?.nextFundingTime ? { nextFundingTime: fresh.mark.nextFundingTime } : {}),
      }
    : undefined;
  const decimals = row?.priceDecimals ?? 2;

  const selectSymbol = (s: string) => {
    setSymbol(s);
    setForm({ ...form, quantity: "", price: "", stopPrice: "", activationPrice: "", takeProfit: "", stopLoss: "", leverage: "" });
  };
  const openSheet = (side: OrderForm["side"]) => {
    setForm({ ...form, side });
    setSheet(true);
  };
  const needAgent = () => {
    setSheet(false);
    accountRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sheet]);

  const step = rules ? (isMarketExec(form.type) ? rules.marketStepSize : rules.stepSize) : undefined;
  const fl = (v: string, s?: string) => (v && s ? floorToStep(v, s) : v) || undefined;
  const lev = parseLeverage(form.leverage);
  const tpsl = form.tpsl && !form.reduceOnly;
  const intent: PerpsAgentIntent = {
    kind: "order",
    symbol,
    side: form.side,
    type: form.type,
    quantity: fl(form.quantity, step) ?? "",
    price: hasLimitPrice(form.type) ? fl(form.price, rules?.tickSize) : undefined,
    stopPrice: hasStopPrice(form.type) ? fl(form.stopPrice, rules?.tickSize) : undefined,
    callbackRate: form.type === "TRAILING_STOP_MARKET" ? fl(form.callbackRate, "0.1") : undefined,
    activationPrice: form.type === "TRAILING_STOP_MARKET" ? fl(form.activationPrice, rules?.tickSize) : undefined,
    workingType: hasStopPrice(form.type) || form.type === "TRAILING_STOP_MARKET" || (tpsl && (form.takeProfit || form.stopLoss)) ? form.workingType : undefined,
    timeInForce: form.timeInForce,
    reduceOnly: form.reduceOnly,
    leverage: lev && !Number.isNaN(lev) ? lev : undefined,
    takeProfit: tpsl ? fl(form.takeProfit, rules?.tickSize) : undefined,
    stopLoss: tpsl ? fl(form.stopLoss, rules?.tickSize) : undefined,
    base: rules?.base,
  };

  const panel = "min-w-0 overflow-hidden rounded-2xl border border-line bg-card";

  return (
    <div className="space-y-3">
      <TitleBar net={net} />
      <MarketHeader
        symbol={symbol}
        row={row}
        rows={markets.data?.rows}
        loading={markets.isPending}
        error={markets.error ? (markets.error as Error).message : undefined}
        onSelect={selectSymbol}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_300px_340px]">
        <section aria-label={t("perps.chartAria")} className={`${panel} h-[380px] sm:h-[440px] lg:col-start-1 lg:row-start-1 lg:h-[500px] xl:h-[560px]`}>
          <PriceChart net={net} symbol={symbol} interval={interval} setInterval={setIv} decimals={decimals} tick={rules?.tickSize} status={status} subscribe={subscribe} />
        </section>

        <section aria-label={t("perps.bookAria")} className={`${panel} lg:col-start-1 lg:row-start-2 xl:col-start-2 xl:row-start-1 xl:h-[560px]`}>
          <BookTrades
            book={book}
            trades={trades}
            decimals={decimals}
            base={rules?.base ?? ""}
            status={status}
            lastPrice={row?.lastPrice}
            markPrice={row?.markPrice}
            bookError={depth.error ? (depth.error as Error).message : undefined}
            onPickPrice={(p) => setForm({ ...form, price: trimDecimal(p), type: hasLimitPrice(form.type) ? form.type : "LIMIT" })}
          />
        </section>

        <section aria-label={t("perps.accountAria")} className={`${panel} lg:col-start-1 lg:row-start-3 xl:col-span-2 xl:row-start-2`}>
          <Blotter agent={agent} symbol={symbol} onNeedAgent={needAgent} />
        </section>

        {sheet ? <div className="fixed inset-0 z-[65] bg-black/60 lg:hidden" aria-hidden="true" onClick={() => setSheet(false)} /> : null}
        <section
          aria-label={t("perps.ticketAria")}
          role={sheet ? "dialog" : undefined}
          aria-modal={sheet ? true : undefined}
          className={`${sheet ? "fixed inset-x-0 bottom-0 z-[70] block max-h-[88vh] overflow-y-auto rounded-t-2xl border-line-2 bg-card p-4 pb-[max(16px,env(safe-area-inset-bottom))]" : "hidden"} lg:static lg:z-auto lg:block lg:max-h-none lg:overflow-visible lg:rounded-2xl lg:border lg:border-line lg:bg-card lg:p-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start xl:col-start-3 xl:row-span-2`}
        >
          {sheet ? (
            <div className="mb-2 flex justify-end lg:hidden">
              <button type="button" onClick={() => setSheet(false)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:text-fg" aria-label={t("perps.closeTicket")}>
                {t("perps.close")}
              </button>
            </div>
          ) : null}
          <OrderTicket row={row} rules={rules} agent={agent} form={form} setForm={setForm} onNeedAgent={needAgent} />
        </section>

        <div ref={accountRef} className="min-w-0 scroll-mt-24 lg:col-start-2 lg:row-start-4 xl:col-start-3 xl:row-start-3">
          <AsterAccountCard net={net} agent={agent} />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-4 xl:col-span-2 xl:row-start-3">
          <AgentPerks intent={intent} />
        </div>
      </div>

      {/* Phone / tablet: ticket opens as a bottom sheet. */}
      <div className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-2 border-t border-line bg-[rgba(11,14,17,.94)] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        <button type="button" className="press h-11 rounded-[10px] bg-up text-[14.5px] font-semibold text-[#05060B]" onClick={() => openSheet("BUY")}>
          {t("perps.buyLong")}
        </button>
        <button type="button" className="press h-11 rounded-[10px] bg-down text-[14.5px] font-semibold text-white" onClick={() => openSheet("SELL")}>
          {t("perps.sellShort")}
        </button>
      </div>
    </div>
  );
}

function TitleBar({ net }: { net: AsterNet }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[21px] font-semibold tracking-tight">{t("perps.title")}</h1>
        <p className="text-[12.5px] text-muted">{t("perps.sub")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <RiskLine className="!text-left" />
        <a className="underline hover:text-fg" href={ASTER_APP_URL[net]} target="_blank" rel="noreferrer">
          {t("perps.openAster")}
        </a>
      </div>
    </div>
  );
}

function AgentPerks({ intent }: { intent: PerpsAgentIntent }) {
  const { chainId, addresses, account, isConnected } = useTowack();
  const { data: bal } = useReadContract({
    address: addresses.agentId,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(addresses.agentId && account) },
  });
  const hasAgent = bal === undefined ? undefined : bal > 0n;
  const { t, rich } = useLocale();

  return (
    <Panel tone="card" shadow={false} className="!p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight">{t("perps.perksTitle")}</h2>
        {hasAgent ? <Pill tone="neutral">{t("perps.agentOk")}</Pill> : hasAgent === false ? <Pill tone="gold">{t("perps.noAgent")}</Pill> : null}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">{rich("perps.perk2", { b: (c) => <b>{c}</b> })}</p>

      <div className="mt-3">
        {!isConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
            <p className="text-[13px] text-sub">{t("perps.connectCheck")}</p>
            <ConnectPill />
          </div>
        ) : !addresses.agentId ? (
          <p className="rounded-xl border border-line bg-gold/5 px-3 py-2 text-[13px]">{t("perps.checkUnavailable")}</p>
        ) : hasAgent === undefined ? (
          <p className="text-[13px] text-muted">{t("perps.checking")}</p>
        ) : hasAgent ? (
          <AgentPathToggle flow="perps" perps={intent} />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-surface px-3 py-3 text-[13px]">
            <Pill tone="gold">{t("perps.locked")}</Pill>
            <p className="mt-2 text-sub">{t("perps.lockedBody")}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
