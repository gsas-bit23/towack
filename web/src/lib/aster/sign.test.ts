import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { approvalBody, approvalMessage, asterTypedData, encodeParams, nextNonce, quotePlus, tradeMessage, typedDataJson } from "./sign";

// Aster's PUBLIC demo credentials from its own API docs (V3 futures, "for demonstration purposes only").
const DEMO_KEY = "0x4fd0a42218f3eae43a6ce26d22544e986139a01e5b34a62db53757ffca81bae1";
const DEMO_USER = "0x63DD5aCC6b1aa0f563956C0e534DD30B6dcF7C4e";
const DEMO_SIGNER = "0x21cF8Ae13Bb72632562c6Fff438652Ba1a151bb0";

describe("encoding", () => {
  it("matches python quote_plus", () => {
    expect(quotePlus("a b*c~d'(!)")).toBe("a+b%2Ac~d%27%28%21%29");
    expect(encodeParams([["symbol", "BTCUSDT"], ["price", "0.5"]])).toBe("symbol=BTCUSDT&price=0.5");
  });
  it("nonces are microseconds and strictly increasing", () => {
    const a = nextNonce(1_700_000_000_000);
    const b = nextNonce(1_700_000_000_000);
    expect(a).toBe("1700000000000000");
    expect(BigInt(b)).toBe(BigInt(a) + 1n);
  });
});

describe("agent-signed trade request", () => {
  const auth = { user: DEMO_USER, signer: DEMO_SIGNER } as const;
  const params: [string, string][] = [["symbol", "ASTERUSDT"], ["type", "LIMIT"], ["side", "BUY"], ["timeInForce", "GTC"], ["quantity", "20"], ["price", "0.5"]];
  const msg = tradeMessage(params, auth, "1748310859508867");

  it("puts nonce, user, signer after the business params", () => {
    expect(msg).toBe(`symbol=ASTERUSDT&type=LIMIT&side=BUY&timeInForce=GTC&quantity=20&price=0.5&nonce=1748310859508867&user=${DEMO_USER}&signer=${DEMO_SIGNER}`);
  });

  it("produces the same EIP-712 signature as Aster's reference python (eth_account) client", async () => {
    // Vector: eth_account.Account.sign_message(encode_typed_data(full_message=<Aster typed data, chainId 1666, msg>), DEMO_KEY)
    const sig = await privateKeyToAccount(DEMO_KEY).signTypedData(asterTypedData(msg, 1666));
    expect(sig).toBe("0x0a56c5923ebf3524475c5f631940ec4c0e41dbd300ad28198d1915d8f3ca49ce26fd1aeb8b0c3079133595da0de38322ae7e860e0c76d032c4a491d27c1430b01c");
    expect(await recoverTypedDataAddress({ ...asterTypedData(msg, 1666), signature: sig })).toBe(DEMO_SIGNER);
  });

  it("serialises full typed data (with EIP712Domain) for BAW --message", () => {
    const t = JSON.parse(typedDataJson("x", 56));
    expect(t.domain).toEqual({ name: "AsterSignTransaction", version: "1", chainId: 56, verifyingContract: "0x0000000000000000000000000000000000000000" });
    expect(t.types.EIP712Domain).toHaveLength(4);
    expect(t.types.Message).toEqual([{ name: "msg", type: "string" }]);
    expect(t.primaryType).toBe("Message");
    expect(t.message).toEqual({ msg: "x" });
  });
});

describe("registerAndApproveAgent", () => {
  const a = { user: DEMO_USER, agentName: "towack-abc", agentAddress: DEMO_SIGNER, expired: 1800000000000, nonce: "1795386000000000" } as const;
  it("signs the documented msg with trade-only scope", () => {
    expect(approvalMessage(a)).toBe(
      `user=${DEMO_USER}&nonce=1795386000000000&agentName=towack-abc&agentAddress=${DEMO_SIGNER}&expired=1800000000000&signatureChainId=56&canSpotTrade=false&canPerpTrade=true&canWithdraw=false&ipWhitelist=`,
    );
  });
  it("body carries the same fields plus the signature", () => {
    const body = new URLSearchParams(approvalBody(a, "0xabc"));
    expect(body.get("canWithdraw")).toBe("false");
    expect(body.get("signatureChainId")).toBe("56");
    expect(body.get("ipWhitelist")).toBe("");
    expect(body.get("signature")).toBe("0xabc");
  });
});
