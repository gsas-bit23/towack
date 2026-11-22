import { decodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { isNative } from "./tokens";
import { DEFAULT_GAS_PRICE_WEI, PROVIDER_LABEL, type Approval, type FetchLike, type Hex, type Provider, type Quote, type QuoteRequest, type TxRequest } from "./types";

/**
 * Relay (https://relay.link): cross-chain bridge + swap, and same-chain swaps. Public, keyless API
 * (`NEXT_PUBLIC_RELAY_API_KEY` only raises rate limits). The quote returns ready-made transactions for the user's
 * wallet; Towack never signs or relays funds itself.
 */

export const RELAY_API = "https://api.relay.link";
export const RELAY_TESTNET_API = "https://api.testnets.relay.link"; // Sepolia / Base Sepolia only: no BSC testnet
/** Origin chains we let Relay quote from (the chains the Towack wallet config can sign on). */
export const RELAY_ORIGINS = [56];

type RelayAmount = { currency?: { chainId?: number; address?: string; symbol?: string; decimals?: number }; amount?: string; amountFormatted?: string; minimumAmount?: string };
type RelayItem = { status?: string; data?: { from?: string; to?: string; data?: string; value?: string; chainId?: number; gas?: string } };
type RelayStep = { id?: string; kind?: string; action?: string; description?: string; requestId?: string; items?: RelayItem[] };
export type RelayQuoteResponse = {
  requestId?: string;
  steps?: RelayStep[];
  fees?: Record<string, RelayAmount | undefined>;
  details?: {
    currencyIn?: RelayAmount;
    currencyOut?: RelayAmount;
    totalImpact?: { percent?: string };
    timeEstimate?: number;
    rate?: string;
  };
  message?: string;
  errorCode?: string;
};

export function relayQuoteBody(req: QuoteRequest) {
  return {
    user: req.user,
    recipient: req.recipient ?? req.user,
    originChainId: req.tokenIn.chainId,
    destinationChainId: req.tokenOut.chainId,
    originCurrency: req.tokenIn.address,
    destinationCurrency: req.tokenOut.address,
    amount: req.amountIn.toString(),
    tradeType: "EXACT_INPUT",
    slippageTolerance: String(Math.round(req.slippageBps)),
  };
}

export function relayProvider(opts: { apiUrl?: string; apiKey?: string } = {}): Provider {
  const base = (opts.apiUrl ?? RELAY_API).replace(/\/$/, "");
  return {
    id: "relay",
    supports: (req) => RELAY_ORIGINS.includes(req.tokenIn.chainId) && req.amountIn > 0n && !(req.tokenIn.chainId === req.tokenOut.chainId && req.tokenIn.address.toLowerCase() === req.tokenOut.address.toLowerCase()),
    async quote(req, ctx) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
      const res = await ctx.fetch(`${base}/quote`, { method: "POST", headers, body: JSON.stringify(relayQuoteBody(req)), signal: ctx.signal });
      const body = (await res.json().catch(() => ({}))) as RelayQuoteResponse;
      if (!res.ok) throw new Error(body.message || `Relay quote failed (HTTP ${res.status})`);
      return normalizeRelay(req, body);
    },
  };
}

export function normalizeRelay(req: QuoteRequest, body: RelayQuoteResponse): Quote {
  const out = body.details?.currencyOut;
  if (!out?.amount) throw new Error("Relay returned no output amount");
  const steps = body.steps ?? [];
  if (steps.length === 0) throw new Error("Relay returned no steps");

  let approval: Approval | undefined;
  const txs: TxRequest[] = [];
  let gasUnits = 0n;
  for (const step of steps) {
    if (step.kind !== "transaction") throw new Error(`This Relay route needs a "${step.kind ?? "unknown"}" step, which this page does not support`);
    for (const item of step.items ?? []) {
      const d = item.data;
      if (!d?.to || !d.data) throw new Error("Relay step is missing transaction data");
      if (d.chainId !== undefined && d.chainId !== req.tokenIn.chainId) throw new Error("Relay asked for a transaction on another chain");
      const tx: TxRequest = { chainId: req.tokenIn.chainId, to: getAddress(d.to), data: d.data as Hex, value: BigInt(d.value ?? "0"), gas: d.gas ? BigInt(d.gas) : undefined };
      if (step.id === "approve") {
        // Replace Relay's approval with our own EXACT approval to the same spender (never unlimited).
        approval = { token: req.tokenIn.address, spender: approveSpender(tx, req.tokenIn.address), amount: req.amountIn };
        continue;
      }
      if (tx.gas) gasUnits += tx.gas;
      txs.push(tx);
    }
  }
  if (txs.length === 0) throw new Error("Relay returned no swap transaction");
  if (!isNative(req.tokenIn) && !approval) {
    // Relay omits the approve step when the allowance is already there. Its swap tx pulls the tokens, so that
    // contract is the spender; the UI re-checks the allowance and only asks for an approval if it is short.
    approval = { token: req.tokenIn.address, spender: txs[0].to, amount: req.amountIn };
  }

  const gasFee = body.fees?.gas;
  const gasCostWei =
    gasFee?.amount && (gasFee.currency?.chainId ?? req.tokenIn.chainId) === req.tokenIn.chainId && isNative({ address: (gasFee.currency?.address ?? "0x0000000000000000000000000000000000000000") as Address })
      ? BigInt(gasFee.amount)
      : gasUnits * (req.gasPriceWei ?? DEFAULT_GAS_PRICE_WEI);
  const relayer = body.fees?.relayer;
  const impact = Number(body.details?.totalImpact?.percent);
  const crossChain = req.tokenIn.chainId !== req.tokenOut.chainId;
  return {
    provider: "relay",
    label: PROVIDER_LABEL.relay,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: req.amountIn,
    amountOut: BigInt(out.amount),
    minAmountOut: BigInt(out.minimumAmount ?? out.amount),
    gasUnits,
    gasCostWei,
    route: crossChain ? `${req.tokenIn.symbol} → ${req.tokenOut.symbol} · cross-chain via Relay solver` : `${req.tokenIn.symbol} → ${req.tokenOut.symbol} · Relay solver`,
    crossChain,
    etaSeconds: body.details?.timeEstimate,
    priceImpactPct: Number.isFinite(impact) ? impact : undefined,
    feeNote: relayer?.amountFormatted ? `Relay fee ${trimNum(relayer.amountFormatted)} ${relayer.currency?.symbol ?? ""} (included in the quote)`.trim() : undefined,
    approval,
    txs,
    relayRequestId: body.requestId ?? steps.find((s) => s.requestId)?.requestId,
  };
}

function approveSpender(tx: TxRequest, token: Address): Address {
  if (tx.to.toLowerCase() !== token.toLowerCase()) throw new Error("Relay approval targets an unexpected contract");
  const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  if (decoded.functionName !== "approve") throw new Error("Relay approval step is not an ERC-20 approve");
  return getAddress(decoded.args[0] as Address);
}

function trimNum(s: string) {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumSignificantDigits: 4 }) : s;
}

export type RelayStatus = "waiting" | "pending" | "submitted" | "success" | "delayed" | "refunded" | "refund" | "failure" | "unknown";

/** GET /intents/status/v2 for a request id (keyless). Terminal states: success, refund(ed), failure. */
export async function relayStatus(requestId: string, fetchFn: FetchLike, apiUrl = RELAY_API): Promise<{ status: RelayStatus; txHashes: string[] }> {
  const res = await fetchFn(`${apiUrl.replace(/\/$/, "")}/intents/status/v2?requestId=${encodeURIComponent(requestId)}`);
  const body = (await res.json().catch(() => ({}))) as { status?: string; txHashes?: string[] };
  if (!res.ok) throw new Error(`Relay status failed (HTTP ${res.status})`);
  const s = (body.status ?? "unknown") as RelayStatus;
  return { status: s, txHashes: body.txHashes ?? [] };
}

export const isRelayTerminal = (s: RelayStatus) => s === "success" || s === "refund" || s === "refunded" || s === "failure";
