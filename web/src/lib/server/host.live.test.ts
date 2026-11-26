import { describe, expect, it } from "vitest";
import { onchainHost, DEALS_V2_DEPLOY_BLOCK, LOG_CHUNK } from "./host";

// Live BSC mainnet check of the host agent's chain reader (public RPC). Skipped unless LIVE_HOST=1.
//   LIVE_HOST=1 npx vitest run src/lib/server/host.live.test.ts
describe.skipIf(!process.env.LIVE_HOST)("host agent chain reader (live BSC)", () => {
  const chain = onchainHost();

  it("reads the head, a full log chunk, deals and USDT from AgentDealsV2", async () => {
    const head = await chain.latestBlock();
    expect(head).toBeGreaterThan(DEALS_V2_DEPLOY_BLOCK);
    const logs = await chain.voteLogs(DEALS_V2_DEPLOY_BLOCK, DEALS_V2_DEPLOY_BLOCK + LOG_CHUNK - 1n);
    expect(Array.isArray(logs)).toBe(true);
    const [d1] = await chain.deals([1n]);
    expect(d1 === null || typeof d1.amount === "bigint").toBe(true);
    expect((await chain.usdt()).toLowerCase()).toBe("0x55d398326f99059ff775485246999027b3197955");
    expect(await chain.txCount("0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d")).toBeGreaterThan(0);
  }, 60_000);
});
