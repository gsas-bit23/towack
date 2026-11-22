"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useReadContract } from "wagmi";
import { agentIdAbi } from "@/abi";
import { AgentPathToggle } from "@/components/AgentPath";
import { ConnectPill } from "@/components/ConnectPill";
import { Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { ASTER_APP_URL, ASTER_DOCS_URL, fetchMarkets, fmtFunding, fmtPrice, trimDecimal, type AsterNet, type MarketRow } from "@/lib/aster/markets";
import type { PerpsAgentIntent } from "@/lib/aster/instruction";
import { floorToStep } from "@/lib/aster/orders";
import { useNow } from "@/lib/useNow";
import { AsterAccountCard, OpenOrders, useAsterAgent } from "./AsterAccount";
import { MarketsBoard } from "./MarketsBoard";
import { EMPTY_FORM, OrderTicket, parseLeverage, type OrderForm } from "./OrderTicket";

export function PerpsDesk() {
  const { meta } = useTowack();
  const [netPick, setNetPick] = useState<AsterNet>();
  const net: AsterNet = netPick ?? (meta.testnet ? "testnet" : "mainnet");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [form, setForm] = useState<OrderForm>(EMPTY_FORM);
  const accountRef = useRef<HTMLDivElement>(null);
  const agent = useAsterAgent(net);

  const markets = useQuery({
    queryKey: ["aster-markets", net],
    queryFn: ({ signal }) => fetchMarkets(net, signal),
    refetchInterval: 15_000,
  });
  const rules = markets.data?.rules.get(symbol);
  const row = markets.data?.rows.find((r) => r.symbol === symbol);

  const intent: PerpsAgentIntent = {
    kind: "order",
    symbol,
    side: form.side,
    type: form.type,
    quantity: rules && form.quantity ? floorToStep(form.quantity, form.type === "MARKET" ? rules.marketStepSize : rules.stepSize) : form.quantity,
    price: rules && form.price ? floorToStep(form.price, rules.tickSize) : form.price,
    timeInForce: form.timeInForce,
    reduceOnly: form.reduceOnly,
    leverage: (() => {
      const l = parseLeverage(form.leverage);
      return l && !Number.isNaN(l) ? l : undefined;
    })(),
    base: rules?.base,
  };

  return (
    <div className="space-y-8">
      <NetBar net={net} setNet={setNetPick} />
      <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
        <div className="col-span-12 space-y-8 lg:col-span-7">
          <MarketStats net={net} symbol={symbol} row={row} />
          <MarketsBoard
            rows={markets.data?.rows}
            loading={markets.isPending}
            error={markets.error ? (markets.error as Error).message : undefined}
            selected={symbol}
            onSelect={(s) => {
              setSymbol(s);
              setForm({ ...form, quantity: "", price: "" });
            }}
          />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <OrderTicket
            net={net}
            row={row}
            rules={rules}
            agent={agent}
            form={form}
            setForm={setForm}
            onNeedAgent={() => accountRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
        <div ref={accountRef} className="col-span-12 scroll-mt-24 space-y-8 lg:col-span-7">
          <AsterAccountCard net={net} agent={agent} />
          <OpenOrders agent={agent} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <AgentPerks intent={intent} />
        </div>
      </div>
    </div>
  );
}

function NetBar({ net, setNet }: { net: AsterNet; setNet: (n: AsterNet) => void }) {
  return (
    <Panel tone="ice" shadow={false} className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border-4 border-navy bg-white p-1" role="tablist" aria-label="Aster network">
            {(["mainnet", "testnet"] as const).map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={net === n}
                onClick={() => setNet(n)}
                className={`rounded-full px-4 py-1.5 font-display text-[15px] font-extrabold ${net === n ? (n === "mainnet" ? "bg-sun" : "bg-sky") : "text-navy/60"}`}
              >
                {n === "mainnet" ? "Aster mainnet" : "Aster testnet"}
              </button>
            ))}
          </div>
          <Pill tone="white">PUBLIC DATA · NO KEY</Pill>
        </div>
        <p className="min-w-0 text-sm font-bold text-navy/70">
          {net === "testnet" ? "Test USDT from Aster's faucet, no real value. " : "Real money. Only trade what you can afford to lose. "}
          <a className="underline" href={ASTER_APP_URL[net]} target="_blank" rel="noreferrer">
            Open Aster ↗
          </a>{" "}
          ·{" "}
          <a className="underline" href={ASTER_DOCS_URL} target="_blank" rel="noreferrer">
            API docs ↗
          </a>
        </p>
      </div>
    </Panel>
  );
}

function MarketStats({ net, symbol, row }: { net: AsterNet; symbol: string; row: MarketRow | undefined }) {
  const now = useNow(1_000);
  const left = row?.nextFundingTime && now ? Math.max(0, Math.floor(row.nextFundingTime / 1000) - now) : undefined;
  const hms = left === undefined ? "—" : `${String(Math.floor(left / 3600)).padStart(2, "0")}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  const up = (row?.changePct ?? 0) >= 0;
  return (
    <Panel tone="sunPale">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black uppercase tracking-widest text-navy/60">{net === "testnet" ? "Aster testnet" : "Aster"} · perpetual</div>
          <h2 className="break-words font-display text-[34px] font-extrabold leading-tight sm:text-[40px]">{symbol}</h2>
        </div>
        <div className="text-right">
          <div className="font-display text-[30px] font-extrabold leading-tight">{trimDecimal(row?.lastPrice)}</div>
          <div className={`font-black ${up ? "text-sky-deep" : "text-candy-deep"}`}>{row?.changePct === undefined ? "" : `${up ? "+" : ""}${row.changePct.toFixed(2)}% 24h`}</div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mark" value={<span className="text-[20px]">{fmtPrice(row?.markPrice, row?.priceDecimals ?? 8)}</span>} />
        <Stat label="Index" value={<span className="text-[20px]">{fmtPrice(row?.indexPrice, row?.priceDecimals ?? 8)}</span>} />
        <Stat label="Funding" value={<span className="whitespace-nowrap text-[18px]">{fmtFunding(row?.fundingRate)}</span>} sub="last rate" />
        <Stat label="Next funding" value={<span className="text-[20px]">{hms}</span>} />
      </div>
    </Panel>
  );
}

function AgentPerks({ intent }: { intent: PerpsAgentIntent }) {
  const { chainId, addresses, account, isConnected, meta } = useTowack();
  const { data: bal } = useReadContract({
    address: addresses.agentId,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(addresses.agentId && account) },
  });
  const hasAgent = bal === undefined ? undefined : bal > 0n;

  return (
    <Panel tone="skyPale" shadow={false}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[24px] font-extrabold">Agent ID perks</h2>
        {hasAgent ? <Pill tone="sky">AGENT ID ✓</Pill> : hasAgent === false ? <Pill tone="candy">NO AGENT ID</Pill> : null}
      </div>
      <ul className="mt-3 space-y-2 font-bold text-navy/80">
        <li>Anyone can view markets and trade here with their own wallet.</li>
        <li>
          Agent ID holders unlock the <b>Give this to your AI agent</b> path for Binance Agentic Wallet.
        </li>
        <li>
          Rebates: none on Aster trades today. Towack takes no fee and has no on-chain rebate hook on Aster. Agent ID is where any future rebate
          alignment would land; nothing is promised.
        </li>
      </ul>

      <div className="mt-5">
        {!isConnected ? (
          <div className="rounded-[28px] border-4 border-navy bg-white p-5 text-center">
            <p className="font-bold text-navy/70">Connect to check your Agent ID ({meta.name}).</p>
            <div className="mt-4 flex justify-center">
              <ConnectPill />
            </div>
          </div>
        ) : !addresses.agentId ? (
          <p className="rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">The Agent ID registry isn&apos;t configured on {meta.name}.</p>
        ) : hasAgent === undefined ? (
          <p className="font-bold text-navy/60">Checking Agent ID…</p>
        ) : hasAgent ? (
          <AgentPathToggle flow="perps" perps={intent} />
        ) : (
          <div className="rounded-2xl border-[3px] border-dashed border-navy bg-white px-4 py-4 font-bold">
            <Pill tone="candy">AGENT PATH LOCKED</Pill>
            <p className="mt-2">
              The AI-agent path is for Agent ID wallets. This wallet holds none on {meta.name}. You can still trade with the order ticket. Agent IDs are
              issued in the official Binance App (mainnet).
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
