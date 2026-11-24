import { formatUnits, toFunctionSelector, zeroAddress } from "viem";
import { DEV_MODE_RULE, EXECUTE_RESULT_RULE } from "./agentRules";
import { CHAIN_NAMES, isNative, VENUES, type ProviderId, type Token } from "./quotes";
import { RELAY_API } from "./quotes/relay";
import { EEEE, ORIGIN_TOKENS } from "./quotes/tokens";

/**
 * "Give this to your AI agent" text for a swap / bridge route picked on /swap. Pure (no React) so it is unit-tested.
 * BAW is mainnet-only and signs on chain 56, so routes are always described with MAINNET addresses: testnet tokens are
 * mapped to their mainnet counterpart by symbol, and unknown ones become visible placeholders.
 */

export type AgentRoute = {
  provider: ProviderId;
  tokenIn: Token; // chain 56 token (use toMainnetToken first)
  tokenOut: Token; // chain 56 or a Relay destination
  amountIn: bigint;
  slippageBps: number;
  v3Fee?: number; // v3 routes: fee tier the page picked
  v2ViaWbnb?: boolean; // v2 routes: 2-hop path through WBNB
  routeText?: string;
};

const SEL = {
  getAmountsOut: toFunctionSelector("getAmountsOut(uint256,address[])"),
  ethForTokens: toFunctionSelector("swapExactETHForTokens(uint256,address[],address,uint256)"),
  tokensForEth: toFunctionSelector("swapExactTokensForETH(uint256,uint256,address[],address,uint256)"),
  tokensForTokens: toFunctionSelector("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"),
  quoteSingle: toFunctionSelector("quoteExactInputSingle((address,address,uint256,uint24,uint160))"),
  exactInputSingle: toFunctionSelector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"),
  multicall: toFunctionSelector("multicall(uint256,bytes[])"),
  unwrap: toFunctionSelector("unwrapWETH9(uint256,address)"),
  approve: toFunctionSelector("approve(address,uint256)"),
};

/** Testnet token → the mainnet token with the same role (tBNB → BNB, test USDT → USDT, TWAK → mainnet TWAK or placeholder). */
export function toMainnetToken(t: Token, mainnetTwak?: `0x${string}`): { token: Token; placeholder: boolean } {
  if (t.chainId !== 97) return { token: t, placeholder: false };
  if (isNative(t)) return { token: ORIGIN_TOKENS[56][0], placeholder: false };
  const bySymbol = ORIGIN_TOKENS[56].find((m) => m.symbol === t.symbol);
  if (bySymbol) return { token: bySymbol, placeholder: false };
  if (t.symbol === "TWAK") {
    return mainnetTwak
      ? { token: { ...t, chainId: 56, address: mainnetTwak }, placeholder: false }
      : { token: { ...t, chainId: 56, address: zeroAddress }, placeholder: true };
  }
  return { token: { ...t, chainId: 56 }, placeholder: true };
}

const human = (amount: bigint, t: Token) => `${formatUnits(amount, t.decimals)} ${t.symbol}`;
const tokenLine = (t: Token, placeholder = false) =>
  placeholder ? `${t.symbol} <${t.symbol}_MAINNET_ADDRESS> (pending: do NOT send until Towack publishes it)` : isNative(t) ? `${t.symbol} (native coin)` : `${t.symbol} ${t.address} (${t.decimals} decimals)`;

const RULES = `Rules (Binance Agentic Wallet, official external-sign flow):
- Origin chain is BNB Smart Chain MAINNET: --binanceChainId 56. Towack's website never signs or broadcasts for me; you prepare, I confirm.
${DEV_MODE_RULE}
- If the token I receive is not a well-known asset, run the BAW swap security pre-check (token audit) first and show me the result.
- For every transaction: \`baw contract-call preview --binanceChainId 56 --from <my wallet> --to <contract> --value <wei> --inputData <hex> --json\`.
  Show me the parsed tx, the risks and the authorityChanges, then WAIT for my explicit "yes".
  Only then: \`baw contract-call execute --requestId <requestId> --json\`. Never execute without a fresh preview + my yes (a separate yes for the approval and for the swap).
${EXECUTE_RESULT_RULE}
- --value is raw wei (an integer). Do not pass a gas price. Approvals are for the EXACT amount only, never unlimited / max uint.
- Quotes go stale in seconds: always re-quote right before you build the calldata. If the fresh quote is more than my slippage worse than the page's estimate, stop and ask me.`;

export function buildSwapInstruction(route: AgentRoute | undefined, opts: { inPlaceholder?: boolean; outPlaceholder?: boolean } = {}): { text: string; missing: string[] } {
  const missing: string[] = [];
  if (opts.inPlaceholder) missing.push(`${route?.tokenIn.symbol ?? "input"} (mainnet)`);
  if (opts.outPlaceholder) missing.push(`${route?.tokenOut.symbol ?? "output"} (mainnet)`);
  const footer = `${RULES}\nTowack skill: /skills/towack/SKILL.md on the Towack site (section "Swap / bridge").`;

  if (!route) {
    return {
      text: `Swap or bridge tokens from BNB Smart Chain mainnet (chain 56) with my Binance Agentic Wallet.
Pick the amount and tokens on the Towack /swap page first: the page then fills in the exact route (PancakeSwap, Uniswap or Relay) here.

${footer}`,
      missing,
    };
  }

  const { tokenIn, tokenOut, amountIn, slippageBps } = route;
  const v = VENUES[56];
  const wbnb = v.wrappedNative;
  const nativeIn = isNative(tokenIn);
  const nativeOut = isNative(tokenOut);
  const crossChain = tokenOut.chainId !== 56;
  const destName = CHAIN_NAMES[tokenOut.chainId] ?? `chain ${tokenOut.chainId}`;
  const slip = `${(slippageBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const head = `${crossChain ? "Bridge" : "Swap"} ${human(amountIn, tokenIn)} on BNB Smart Chain mainnet (chain 56) → ${tokenOut.symbol} on ${crossChain ? destName : "BNB Smart Chain"} with my Binance Agentic Wallet.
Route picked on the Towack swap page: ${route.routeText ?? route.provider}. Slippage: ${slip} (${slippageBps} bps). Recipient: my own BAW wallet.
Pay: ${tokenLine(tokenIn, opts.inPlaceholder)} · amountIn = ${amountIn} (raw units)
Get: ${tokenLine(tokenOut, opts.outPlaceholder)}${crossChain ? ` on ${destName} (chain ${tokenOut.chainId})` : ""}
`;
  const approveStep = (spender: string, n: number) =>
    nativeIn ? "" : `${n}) ${tokenIn.symbol}.approve(${spender}, amountIn) (selector ${SEL.approve}): --to ${tokenIn.address} --value 0. EXACT amountIn only.\n`;

  let body = "";
  switch (route.provider) {
    case "pancakeV2": {
      const r = v.pancakeV2!.router;
      const a = nativeIn ? wbnb : tokenIn.address;
      const b = nativeOut ? wbnb : tokenOut.address;
      const path = route.v2ViaWbnb ? `[${a}, ${wbnb}, ${b}]` : `[${a}, ${b}]`;
      const fn = nativeIn
        ? `swapExactETHForTokens(amountOutMin, path, myWallet, deadline) (selector ${SEL.ethForTokens}): --to ${r} --value amountIn`
        : nativeOut
          ? `swapExactTokensForETH(amountIn, amountOutMin, path, myWallet, deadline) (selector ${SEL.tokensForEth}): --to ${r} --value 0`
          : `swapExactTokensForTokens(amountIn, amountOutMin, path, myWallet, deadline) (selector ${SEL.tokensForTokens}): --to ${r} --value 0`;
      body = `Venue: PancakeSwap v2 router ${r}. path = ${path}
1) Fresh quote: eth_call router.getAmountsOut(amountIn, path) (selector ${SEL.getAmountsOut}); quote = last element.
   amountOutMin = quote * (10000 - ${slippageBps}) / 10000. deadline = now + 600 seconds (unix). Show me quote + amountOutMin.
${approveStep(r, 2)}${nativeIn ? 2 : 3}) ${fn}.
`;
      break;
    }
    case "pancakeV3":
    case "uniswapV3": {
      const cfg = route.provider === "pancakeV3" ? v.pancakeV3! : v.uniswapV3!;
      const name = route.provider === "pancakeV3" ? "PancakeSwap v3" : "Uniswap v3";
      const fee = route.v3Fee ?? cfg.fees[1];
      const a = nativeIn ? wbnb : tokenIn.address;
      const b = nativeOut ? wbnb : tokenOut.address;
      body = `Venue: ${name}. Quoter ${cfg.quoter} · Router ${cfg.router} · pool fee ${fee} (${fee / 10_000}%).
1) Fresh quote: eth_call quoter.quoteExactInputSingle((tokenIn ${a}, tokenOut ${b}, amountIn, fee ${fee}, sqrtPriceLimitX96 0)) (selector ${SEL.quoteSingle}); amountOut = first return value.
   amountOutMinimum = amountOut * (10000 - ${slippageBps}) / 10000. deadline = now + 600 seconds (unix). Show me amountOut + amountOutMinimum.
${approveStep(cfg.router, 2)}${nativeIn ? 2 : 3}) router.multicall(uint256 deadline, bytes[] data) (selector ${SEL.multicall}): --to ${cfg.router} --value ${nativeIn ? "amountIn" : "0"}, with data =
   [ exactInputSingle((tokenIn ${a}, tokenOut ${b}, fee ${fee}, recipient ${nativeOut ? "0x0000000000000000000000000000000000000002 (the router itself)" : "myWallet"}, amountIn, amountOutMinimum, 0)) (selector ${SEL.exactInputSingle})${
     nativeOut ? `,\n     unwrapWETH9(amountOutMinimum, myWallet) (selector ${SEL.unwrap}) ` : " "
   }]
`;
      break;
    }
    case "relay": {
      const req = {
        user: "<MY_BAW_WALLET>",
        recipient: "<MY_BAW_WALLET or another address I control on " + destName + ">",
        originChainId: 56,
        destinationChainId: tokenOut.chainId,
        originCurrency: tokenIn.address,
        destinationCurrency: tokenOut.address,
        amount: amountIn.toString(),
        tradeType: "EXACT_INPUT",
        slippageTolerance: String(slippageBps),
      };
      body = `Venue: Relay (relay.link), keyless public API. 0x000…000 means the native coin.
1) Fresh quote: POST ${RELAY_API}/quote with JSON:
   ${JSON.stringify(req)}
   Show me details.currencyOut.amountFormatted, details.currencyOut.minimumAmount, fees.relayer and details.timeEstimate, and wait for my yes.
2) Run steps[] in order. Every step must be kind "transaction" and every items[].data.chainId must be 56; otherwise STOP and tell me.
   - Step "approve": check it is ${tokenIn.symbol}.approve(spender, amount) with amount == amountIn (never more); else STOP.
   - For each item: baw contract-call preview --binanceChainId 56 --from <my wallet> --to <item.data.to> --value <item.data.value> --inputData <item.data.data> --json → show me → wait for "yes" → execute.
3) Track: GET ${RELAY_API}/intents/status/v2?requestId=<requestId from the step> every few seconds until status is success, refund or failure.
   Report only the terminal status${crossChain ? `; the ${tokenOut.symbol} lands on ${destName}` : ""}. "pending" / "waiting" is not done.
`;
      break;
    }
    case "zeroex":
    case "oneinch": {
      const isZero = route.provider === "zeroex";
      const native = (t: Token) => (isNative(t) ? EEEE : t.address);
      body = isZero
        ? `Venue: 0x Swap API v2 (needs my own 0x API key; Towack does not provide one).
1) Fresh quote: GET https://api.0x.org/swap/allowance-holder/quote?chainId=56&sellToken=${native(tokenIn)}&buyToken=${native(tokenOut)}&sellAmount=${amountIn}&taker=<MY_BAW_WALLET>&slippageBps=${slippageBps}
   headers: 0x-api-key: <MY_KEY>, 0x-version: v2. Show me buyAmount + minBuyAmount.
${nativeIn ? "" : `2) If issues.allowance is set: ${tokenIn.symbol}.approve(issues.allowance.spender, amountIn) (selector ${SEL.approve}), exact amount only.\n`}${nativeIn ? 2 : 3}) Preview transaction.to / transaction.value / transaction.data from the quote.
`
        : `Venue: 1inch Swap API v6 (needs my own 1inch API key; Towack does not provide one).
1) Fresh quote: GET https://api.1inch.dev/swap/v6.0/56/swap?src=${native(tokenIn)}&dst=${native(tokenOut)}&amount=${amountIn}&from=<MY_BAW_WALLET>&slippage=${slippageBps / 100}
   header: Authorization: Bearer <MY_KEY>. Show me dstAmount.
${approveStep("0x111111125421cA6dc452d289314280a0f8842A65", 2)}${nativeIn ? 2 : 3}) Preview tx.to / tx.value / tx.data from the response.
`;
      break;
    }
  }

  const alt = crossChain
    ? ""
    : `\nBAW-native alternative (Binance's own routing, NOT the route above): \`baw market-order quote --fromTokenQty ${formatUnits(amountIn, tokenIn.decimals)} --fromToken ${nativeIn ? EEEE : tokenIn.address} --toToken ${nativeOut ? EEEE : tokenOut.address} --binanceChainId 56 --slippage ${slippageBps / 100} --json\`, show me, wait for yes, then \`market-order swap\` with the same flags and poll \`market-order list --orderId <id>\` until FINISHED or FAILED.\n`;

  return { text: `${head}\n${body}${alt}\n${footer}`, missing };
}
