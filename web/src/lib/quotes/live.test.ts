/**
 * OPT-IN live check (`npm run test:live`): real keyless quotes from BSC mainnet + Relay, and an eth_call
 * simulation of the router calldata we build. Read-only: nothing is signed or broadcast. Skipped by `npm test`.
 */
import { createPublicClient, getAddress, http } from "viem";
import { bsc } from "viem/chains";
import { describe, expect, it } from "vitest";
import { executionPlan, getBestRoutes, ORIGIN_TOKENS, pancakeV2, pancakeV3, relayProvider, RELAY_DESTINATIONS, uniswapV3, type FetchLike, type Reader } from "./index";

const LIVE = Boolean(process.env.LIVE_QUOTES);
// A large public BSC exchange hot wallet, used only as the eth_call "from" so msg.value is covered. Simulation only.
const RICH = getAddress("0xF977814e90dA44bFA03b6295A0616a897441aceC");

describe.skipIf(!LIVE)("live BSC mainnet quotes (read-only)", () => {
  const client = createPublicClient({ chain: bsc, transport: http("https://bsc-dataseed.bnbchain.org") });
  const reader = client as unknown as Reader;
  const [BNB, USDT] = ORIGIN_TOKENS[56];
  const req = { tokenIn: BNB, tokenOut: USDT, amountIn: 10n ** 17n, slippageBps: 100, user: RICH };

  it("quotes and simulates every AMM route for 0.1 BNB → USDT", async () => {
    const r = await getBestRoutes(req, [pancakeV3, uniswapV3, pancakeV2], { reader, fetch: fetch as unknown as FetchLike });
    console.log(r.quotes.map((q) => `${q.label}: ${q.amountOut} (${q.route}) net ${q.netOut}`), r.errors);
    expect(r.quotes.length).toBe(3);
    for (const q of r.quotes) {
      const { txs } = executionPlan(q, { recipient: RICH, nowSec: Math.floor(Date.now() / 1000) });
      const res = await client.call({ account: RICH, to: txs[0].to, data: txs[0].data, value: txs[0].value });
      expect(res.data, q.label).toBeDefined();
    }
  }, 60_000);

  it("Relay: 0.1 BNB on BSC → ETH on Base, deposit tx simulates", async () => {
    const baseEth = RELAY_DESTINATIONS.find((c) => c.id === 8453)!.tokens[0];
    const q = await relayProvider().quote({ ...req, tokenOut: baseEth }, { fetch: fetch as unknown as FetchLike });
    console.log(`Relay: ${q.amountOut} wei ETH on Base, min ${q.minAmountOut}, eta ${q.etaSeconds}s, ${q.feeNote}`);
    const tx = q.txs![0];
    await client.call({ account: RICH, to: tx.to, data: tx.data, value: tx.value });
  }, 60_000);
});
