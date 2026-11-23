/**
 * "Give this to your AI agent" text for Aster perps with a Binance Agentic Wallet (BAW).
 *
 * Aster orders are NOT a BNB Smart Chain contract call, so `baw contract-call` cannot place them. The best supported
 * path: BAW signs ONE EIP-712 message (`baw sign-message`, chain 56) that approves a trade-only Aster API wallet whose
 * key the user's own agent generates and keeps locally; that API wallet then signs each order (EIP-712, chain 1666).
 * Every step is preview → show the user → explicit "yes" → execute. The Towack site never signs or sends anything.
 */
import { ASTER_REST } from "./markets";
import { hasLimitPrice, hasStopPrice, ORDER_TYPE_LABEL, type MarginType, type OrderType, type WorkingType } from "./orders";
import { typedDataJson, ASTER_TRADE_CHAIN_ID, AGENT_TTL_DAYS } from "./sign";

export type PerpsAgentIntent =
  | {
      kind: "order";
      symbol: string;
      side: "BUY" | "SELL";
      type: OrderType;
      quantity: string;
      price?: string;
      stopPrice?: string;
      callbackRate?: string;
      activationPrice?: string;
      workingType?: WorkingType;
      timeInForce?: string;
      reduceOnly?: boolean;
      leverage?: number;
      /** Switch the symbol's margin mode first (POST /fapi/v3/marginType). */
      marginType?: MarginType;
      /** Attached reduce-only take-profit / stop-loss triggers, placed after the entry. */
      takeProfit?: string;
      stopLoss?: string;
      base?: string;
    }
  | { kind: "cancel"; symbol: string; orderId?: string };

const HOST = ASTER_REST.mainnet;
const PH = (s: string) => `<${s}>`;

/** Request param string. Values are symbols, enums and decimals (URL-safe), so this equals the urlencoded form; placeholders stay readable.
 * Same field order as `buildOrder` in orders.ts, so the agent signs what the website would have signed. */
export function intentParams(i: PerpsAgentIntent): string {
  if (i.kind === "cancel") return `symbol=${i.symbol}&orderId=${i.orderId || PH("ORDER_ID")}`;
  const p: [string, string][] = [["symbol", i.symbol], ["side", i.side], ["type", i.type]];
  if (hasLimitPrice(i.type)) p.push(["timeInForce", i.timeInForce ?? "GTC"]);
  p.push(["quantity", i.quantity || PH("SIZE")]);
  if (hasLimitPrice(i.type)) p.push(["price", i.price || PH("PRICE")]);
  if (hasStopPrice(i.type)) p.push(["stopPrice", i.stopPrice || PH("TRIGGER")]);
  if (i.type === "TRAILING_STOP_MARKET") {
    if (i.activationPrice) p.push(["activationPrice", i.activationPrice]);
    p.push(["callbackRate", i.callbackRate || PH("CALLBACK_PCT")]);
  }
  if (i.workingType && (hasStopPrice(i.type) || i.type === "TRAILING_STOP_MARKET")) p.push(["workingType", i.workingType]);
  if (i.reduceOnly) p.push(["reduceOnly", "true"]);
  return p.map(([k, v]) => `${k}=${v}`).join("&");
}

/** Reduce-only TP / SL legs for an order intent (same layout as `buildBracket`). */
export function bracketParams(i: PerpsAgentIntent): { leg: "TP" | "SL"; params: string }[] {
  if (i.kind !== "order") return [];
  const close = i.side === "BUY" ? "SELL" : "BUY";
  const legs: { leg: "TP" | "SL"; params: string }[] = [];
  const wt = i.workingType ? `&workingType=${i.workingType}` : "";
  const qty = i.quantity || PH("SIZE");
  if (i.takeProfit) legs.push({ leg: "TP", params: `symbol=${i.symbol}&side=${close}&type=TAKE_PROFIT_MARKET&quantity=${qty}&stopPrice=${i.takeProfit}${wt}&reduceOnly=true` });
  if (i.stopLoss) legs.push({ leg: "SL", params: `symbol=${i.symbol}&side=${close}&type=STOP_MARKET&quantity=${qty}&stopPrice=${i.stopLoss}${wt}&reduceOnly=true` });
  return legs;
}

function describe(i: PerpsAgentIntent): string {
  if (i.kind === "cancel") return `Cancel my open Aster order ${i.orderId || PH("ORDER_ID")} on ${i.symbol}.`;
  const dir = i.side === "BUY" ? "BUY (long / close short)" : "SELL (short / close long)";
  const label = ORDER_TYPE_LABEL[i.type] ?? i.type;
  const trig = hasStopPrice(i.type) ? ` triggers at ${i.stopPrice || PH("TRIGGER")} (${i.workingType === "MARK_PRICE" ? "mark price" : "last price"})` : "";
  const what =
    i.type === "MARKET"
      ? "MARKET (fills at the book, mark-price protected)"
      : i.type === "TRAILING_STOP_MARKET"
        ? `TRAILING STOP, callback ${i.callbackRate || PH("CALLBACK_PCT")}%${i.activationPrice ? `, activates at ${i.activationPrice}` : ""}`
        : hasLimitPrice(i.type)
          ? `${label.toUpperCase()} ${i.timeInForce ?? "GTC"} at ${i.price || PH("PRICE")} USDT${trig}`
          : `${label.toUpperCase()}${trig}`;
  const tpsl = [i.takeProfit ? `TP ${i.takeProfit}` : "", i.stopLoss ? `SL ${i.stopLoss}` : ""].filter(Boolean).join(", ");
  return `${i.symbol} perpetual · ${dir} · ${what} · size ${i.quantity || PH("SIZE")} ${i.base ?? "base asset"}${i.reduceOnly ? " · reduce-only" : ""}${i.leverage ? ` · leverage ${i.leverage}x` : ""}${i.marginType ? ` · ${i.marginType === "ISOLATED" ? "isolated" : "cross"} margin` : ""}${tpsl ? ` · attached ${tpsl} (reduce-only)` : ""}`;
}

const SETUP_MSG = `user=<MY_BAW_ADDRESS>&nonce=<NOW_MICROSECONDS>&agentName=towack-agent&agentAddress=<API_WALLET_ADDRESS>&expired=<NOW_MS + ${AGENT_TTL_DAYS} days in ms>&signatureChainId=56&canSpotTrade=false&canPerpTrade=true&canWithdraw=false&ipWhitelist=`;

export function buildPerpsInstruction(i: PerpsAgentIntent): string {
  const params = intentParams(i);
  const isOrder = i.kind === "order";
  const endpoint = isOrder ? "POST /fapi/v3/order" : "DELETE /fapi/v3/order";
  const legs = bracketParams(i);
  const sign = `msg = <request params>&nonce=<NOW_MICROSECONDS>&user=<MY_BAW_ADDRESS>&signer=<API_WALLET_ADDRESS> (urlencoded, this order)`;
  const steps: string[] = [];
  if (isOrder && i.marginType) steps.push(`Margin mode first: POST ${HOST}/fapi/v3/marginType with symbol=${i.symbol}&marginType=${i.marginType}, signed exactly like the order. If Aster rejects it (e.g. open position or orders in the other mode), stop and tell me.`);
  if (isOrder && i.leverage) steps.push(`Leverage first: POST ${HOST}/fapi/v3/leverage with symbol=${i.symbol}&leverage=${i.leverage}, signed exactly like the order.`);
  steps.push(
    `Sign with the API wallet key: ${sign}.\n    EIP-712: same typed data as above but domain.chainId = ${ASTER_TRADE_CHAIN_ID.mainnet}. Body = msg&signature=0x<sig>.\n    ${endpoint} at ${HOST}, Content-Type application/x-www-form-urlencoded. The nonce must be within 60 s of now and never reused.`,
  );
  for (const l of legs) steps.push(`Only if the entry was accepted: ${l.leg === "TP" ? "take-profit" : "stop-loss"} leg, POST /fapi/v3/order with ${l.params} (one-way mode, reduce-only, signed the same way). Sent one at a time, not batchOrders.`);
  return `Aster perpetuals ${isOrder ? "order" : "cancel"} for my Binance Agentic Wallet (BAW) account. Mainnet only.
What I want (send NOTHING until I say yes): ${describe(i)}
Request params: ${params}

READ FIRST: Aster orders are NOT a BNB Smart Chain contract call. Do not use \`baw contract-call\` for this.
Aster runs its own order book. BAW is used for exactly one thing: an EIP-712 signature (\`baw sign-message\`, --binanceChainId 56)
that approves a trade-only Aster "API wallet". That API wallet then signs each order. Towack's website never signs, never sends,
and never sees any key. Testnet is not supported by BAW.

Before anything: my BAW address must already have deposited USDT margin on Aster (asterdex.com, logged in with this same wallet).
Aster rejects every trading call with code -5050 until it has. If you get -5050, stop and tell me.

A) One-time setup (skip if you already hold a working trade-only Aster API wallet key for my BAW address on this machine):
 1) \`baw wallet settings --json\`: devMode.enabled must be true. If not, tell me to enable Developer Mode in the Binance App and WAIT.
 2) Generate a fresh EVM keypair LOCALLY (this is the API wallet). Keep its private key only on this machine: never print it,
    never paste it into chat, never send it to Towack or anyone. It can trade perps but can never withdraw.
 3) msg (exact field order, canWithdraw MUST be false):
    ${SETUP_MSG}
 4) Typed data (put msg in message.msg): ${typedDataJson("<msg>", 56)}
    \`baw sign-message preview --binanceChainId 56 --signType EIP712 --message '{"method":"eth_signTypedData_v4","params":["<MY_BAW_ADDRESS>","<typed data JSON string>"]}' --json\`
    Show me parsedMessage and risks, then WAIT for my explicit "yes". Only then \`baw sign-message execute --requestId <requestId> --json\`
    (if it says PENDING_CONFIRMATION I confirm in the Binance App; then \`baw sign-message result --order-id <orderId> --json\`).
    Use the 65-byte signature: if BAW returns 64 bytes plus signatureRecovery, append (27 + signatureRecovery) as one hex byte.
 5) POST ${HOST}/fapi/v3/registerAndApproveAgent, Content-Type application/x-www-form-urlencoded, body = the msg fields + &signature=0x<sig>.
    Expect {"code":200,"msg":"success"}.

B) ${isOrder ? "The order" : "The cancel"} (preview → my yes → execute):
 1) Preview: GET ${HOST}/fapi/v3/premiumIndex?symbol=${i.symbol} and GET ${HOST}/fapi/v3/exchangeInfo (no key needed).
    Show me mark price, funding rate, ${isOrder ? "notional (size × price), the LOT_SIZE stepSize/minQty, PRICE_FILTER tickSize and MIN_NOTIONAL checks, " : "the open order (GET /fapi/v3/openOrders, signed as below), "}and the exact param string${legs.length ? "s" : ""}.
    WAIT for my explicit "yes" to this exact ${isOrder ? "order" : "cancel"}. A new size, price or side needs a new preview and a new yes.
${steps.map((st, n) => ` ${n + 2}) ${st}\n`).join("")} ${steps.length + 2}) Report Aster's response${legs.length ? "s" : ""} as returned (orderId, status). Do not retry a failed request without asking me.

Rules: never approve canWithdraw=true or canSpotTrade=true; never place, change or cancel anything without my yes for that exact request;
never store the API wallet key outside this machine. Perps use leverage: I can lose my margin fast, and positions can be liquidated.
Aster API docs: https://github.com/asterdex/api-docs · Towack skill: /skills/towack/SKILL.md on the Towack site.`;
}
