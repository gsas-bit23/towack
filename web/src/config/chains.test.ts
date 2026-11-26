import { describe, expect, it, vi } from "vitest";

describe("production chain lock", () => {
  it("stays on BSC mainnet (56) even when a stale env asks for testnet (97)", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_CHAIN_ID", "97");
    vi.resetModules();
    const { APP_CHAIN_ID, DEFAULT_CHAIN_ID, CHAIN_META, isAppChain } = await import("./chains");
    expect(APP_CHAIN_ID).toBe(56);
    expect(DEFAULT_CHAIN_ID).toBe(56);
    expect(CHAIN_META.explorer).toBe("https://bscscan.com");
    expect(isAppChain(56)).toBe(true);
    expect(isAppChain(97)).toBe(false);
    expect(isAppChain(undefined)).toBe(false);
    vi.unstubAllEnvs();
  }, 30_000); // fresh import of the wallet stack is slow when the whole suite runs in parallel

  it("only exposes the mainnet address book at runtime", async () => {
    const { ADDRESSES } = await import("./addresses");
    expect(Object.keys(ADDRESSES)).toEqual(["56"]);
    expect(ADDRESSES[56].launch).toBeDefined();
    expect(ADDRESSES[56].drawV2).toBeDefined();
  });

  it("configures wagmi with BSC mainnet only", async () => {
    const { wagmiConfig } = await import("./wagmi");
    expect(wagmiConfig.chains.map((c) => c.id)).toEqual([56]);
  }, 30_000);
});
