"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n";
import type { CandlestickData, HistogramData, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { AsterNet } from "@/lib/aster/markets";
import { CHART_INTERVALS, fetchKlines, type Candle, type ChartInterval } from "@/lib/aster/marketData";
import type { FeedStatus } from "./useAsterStream";

const UP = "#2FE3A0";
const DOWN = "#FF4D6D";
type Lib = typeof import("lightweight-charts");

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
const toVol = (c: Candle): HistogramData<UTCTimestamp> => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(14,203,129,.35)" : "rgba(246,70,93,.35)" });

function pollMs(interval: string): number {
  return interval === "1m" || interval === "5m" ? 5_000 : 15_000;
}

/**
 * TradingView lightweight-charts candles from Aster `GET /fapi/v3/klines`, kept live by the `@kline_<interval>`
 * websocket stream (via `subscribe`), or by polling klines when the websocket is unavailable. Never invents candles.
 */
export function PriceChart({
  net,
  symbol,
  interval,
  setInterval: pick,
  decimals,
  tick,
  status,
  subscribe,
}: {
  net: AsterNet;
  symbol: string;
  interval: ChartInterval;
  setInterval: (i: ChartInterval) => void;
  decimals: number;
  tick: string | undefined;
  status: FeedStatus;
  subscribe: (cb: (c: Candle) => void) => () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; lib: Lib }>(undefined);
  const series = useRef<{ candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; last: number }>(undefined);
  const { t } = useLocale();
  const [ready, setReady] = useState(0);
  const [legend, setLegend] = useState<Candle>();

  const klines = useQuery({
    queryKey: ["aster-klines", net, symbol, interval],
    queryFn: ({ signal }) => fetchKlines(net, symbol, interval, 500, signal),
    refetchInterval: status === "poll" ? pollMs(interval) : false,
    staleTime: 2_000,
  });

  // Create the chart once (client-only, dynamic import), destroy on unmount.
  useEffect(() => {
    let dead = false;
    import("lightweight-charts").then((lib) => {
      const el = box.current;
      if (dead || !el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const mono = getComputedStyle(el).fontFamily || "ui-monospace, monospace";
      const chart = lib.createChart(el, {
        autoSize: true,
        layout: { background: { type: lib.ColorType.Solid, color: "#05060B" }, textColor: "#7F89A3", fontFamily: mono, fontSize: 11 },
        grid: { vertLines: { color: "rgba(35,41,49,.55)" }, horzLines: { color: "rgba(35,41,49,.55)" } },
        rightPriceScale: { borderColor: "#1A2032" },
        timeScale: { borderColor: "#1A2032", timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: { mode: lib.CrosshairMode.Normal, vertLine: { color: "#34406A", labelBackgroundColor: "#141A2A" }, horzLine: { color: "#34406A", labelBackgroundColor: "#141A2A" } },
        kineticScroll: { touch: !reduce, mouse: false },
        handleScroll: { vertTouchDrag: false },
      });
      chartRef.current = { chart, lib };
      setReady((n) => n + 1);
    });
    return () => {
      dead = true;
      chartRef.current?.chart.remove();
      chartRef.current = undefined;
      series.current = undefined;
    };
  }, []);

  // (Re)create series on symbol / interval / precision change.
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const { chart, lib } = c;
    const minMove = tick && Number(tick) > 0 ? Number(tick) : 10 ** -Math.min(decimals, 8);
    const candles = chart.addSeries(lib.CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceFormat: { type: "price", precision: Math.min(decimals, 8), minMove },
    });
    const volume = chart.addSeries(lib.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    series.current = { candles, volume, last: 0 };
    const onMove = (p: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      const bar = p.seriesData.get(candles) as CandlestickData | undefined;
      const vol = p.seriesData.get(volume) as HistogramData | undefined;
      setLegend(bar && "open" in bar ? { time: Number(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: vol?.value ?? 0 } : undefined);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      try {
        chart.removeSeries(candles);
        chart.removeSeries(volume);
      } catch {
        /* chart already removed */
      }
      series.current = undefined;
    };
  }, [ready, symbol, interval, net, decimals, tick]);

  // Full data (initial load and every poll).
  const data = klines.data;
  useEffect(() => {
    const s = series.current;
    if (!s || !data) return;
    s.candles.setData(data.map(toBar));
    s.volume.setData(data.map(toVol));
    s.last = data.length ? data[data.length - 1].time : 0;
    if (data.length) chartRef.current?.chart.timeScale().scrollToRealTime();
  }, [data, ready, symbol, interval, net, decimals, tick]);

  // Live candle updates from the websocket.
  useEffect(
    () =>
      subscribe((c) => {
        const s = series.current;
        if (!s || !s.last || c.time < s.last) return;
        s.candles.update(toBar(c));
        s.volume.update(toVol(c));
        s.last = c.time;
      }),
    [subscribe],
  );

  const last = data?.[data.length - 1];
  const show = legend ?? last;
  const fmt = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(Math.min(decimals, 8)));
  const up = show ? show.close >= show.open : true;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label={t("perps.c.intervalAria")}>
          {CHART_INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={interval === i}
              onClick={() => pick(i)}
              className={`rounded-md px-2 py-1 font-mono text-[12px] font-medium ${interval === i ? "bg-card-2 text-gold" : "text-muted hover:text-fg"}`}
            >
              {i}
            </button>
          ))}
        </div>
        <FeedBadge status={status} note={status === "poll" ? t("perps.feed.pollEvery", { s: pollMs(interval) / 1000 }) : undefined} />
      </div>
      <div className="flex min-h-[18px] flex-wrap gap-x-3 px-3 pt-1.5 font-mono text-[11px] tabular-nums text-muted">
        {show ? (
          <>
            <span>
              O <span className={up ? "text-up" : "text-down"}>{fmt(show.open)}</span>
            </span>
            <span>
              H <span className={up ? "text-up" : "text-down"}>{fmt(show.high)}</span>
            </span>
            <span>
              L <span className={up ? "text-up" : "text-down"}>{fmt(show.low)}</span>
            </span>
            <span>
              C <span className={up ? "text-up" : "text-down"}>{fmt(show.close)}</span>
            </span>
            <span className="hidden sm:inline">V {show.volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          </>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={box} className="absolute inset-0 font-mono" aria-label={t("perps.c.aria", { symbol, interval })} role="img" />
        {klines.isPending ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted">{t("perps.c.loading", { symbol })}</div>
        ) : klines.error ? (
          <div role="alert" className="absolute inset-x-3 top-3 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-[13px]">
            {t("perps.c.err", { e: (klines.error as Error).message })}
          </div>
        ) : data && data.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted">{t("perps.c.none", { symbol })}</div>
        ) : null}
      </div>
    </div>
  );
}

export function FeedBadge({ status, note }: { status: FeedStatus; note?: string }) {
  const { t } = useLocale();
  const label = status === "live" ? t("perps.feed.live") : status === "poll" ? (note ?? t("perps.feed.poll")) : t("perps.feed.connecting");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-up" : status === "poll" ? "bg-gold" : "bg-dim"}`} aria-hidden="true" />
      {label}
    </span>
  );
}
