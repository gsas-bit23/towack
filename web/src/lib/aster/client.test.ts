import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentAddressFromKey, explainAsterError, parseStoredAgent, signedRequest, type StoredAgent } from "./client";
import { asterTypedData } from "./sign";

const key = generatePrivateKey();
const signer = privateKeyToAccount(key).address;
const user = privateKeyToAccount(generatePrivateKey()).address;
const agent: StoredAgent = { v: 1, net: "testnet", user, signer, key, expired: 0, source: "generated", remember: false };

afterEach(() => vi.unstubAllGlobals());

describe("stored agent", () => {
  it("round-trips and rejects bad / cross-network records", () => {
    const raw = JSON.stringify(agent);
    expect(parseStoredAgent(raw, "testnet")?.signer).toBe(signer);
    expect(parseStoredAgent(raw, "mainnet")).toBeUndefined();
    expect(parseStoredAgent(JSON.stringify({ ...agent, key: "0x12" }), "testnet")).toBeUndefined();
    expect(parseStoredAgent("not json", "testnet")).toBeUndefined();
    expect(parseStoredAgent(null, "testnet")).toBeUndefined();
  });
  it("derives the API wallet address from a pasted key", () => {
    expect(agentAddressFromKey(key)).toBe(signer);
    expect(agentAddressFromKey(key.slice(2))).toBe(signer);
    expect(agentAddressFromKey("0x1234")).toBeUndefined();
  });
});

describe("signedRequest (mocked network)", () => {
  it("sends only the signed string + signature to Aster, never the key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ orderId: 7, status: "NEW" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await signedRequest(agent, "POST", "/fapi/v3/order", [["symbol", "BTCUSDT"], ["side", "BUY"], ["type", "MARKET"], ["quantity", "0.001"]]);
    expect(res).toEqual({ orderId: 7, status: "NEW" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fapi.asterdex-testnet.com/fapi/v3/order");
    const body = String(init.body);
    expect(body).not.toContain(key.slice(2));
    const [msg, sig] = body.split("&signature=");
    expect(msg).toMatch(new RegExp(`^symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&nonce=\\d{16}&user=${user}&signer=${signer}$`));
    expect(await recoverTypedDataAddress({ ...asterTypedData(msg, 714), signature: sig as Hex })).toBe(signer);
  });
  it("puts GET params in the query string and surfaces Aster errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: -5050, msg: "This function can only be used after deposit" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await signedRequest(agent, "GET", "/fapi/v3/balance").catch((e) => e);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toMatch(/\/fapi\/v3\/balance\?nonce=\d+&user=.+&signer=.+&signature=0x/);
    expect(explainAsterError(err)).toContain("deposit");
  });
});
