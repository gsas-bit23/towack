/**
 * Aster Futures V3 request signing (EIP-712), per https://github.com/asterdex/api-docs (V3 futures + testnet docs).
 *
 * Two kinds of signature:
 * 1. Agent approval (`POST /fapi/v3/registerAndApproveAgent`): signed ONCE by the user's own main wallet
 *    (browser wallet via wagmi, or Binance Agentic Wallet `sign-message`). EIP-712 domain chainId = signatureChainId (56).
 * 2. Trading requests (order, cancel, leverage, balance, open orders): signed by the approved "API wallet" (agent) key,
 *    EIP-712 domain chainId 1666 (mainnet) / 714 (testnet), message.msg = the url-encoded request string.
 *
 * The agent key never leaves the user's browser: only the signature is sent, and only to Aster's own API host.
 * This module is pure (no storage, no network) so it can be unit-tested.
 */
import { zeroAddress, type Address, type Hex } from "viem";
import type { AsterNet } from "./markets";

export const ASTER_DOMAIN_NAME = "AsterSignTransaction";
/** EIP-712 domain chainId for agent-signed trading requests. */
export const ASTER_TRADE_CHAIN_ID: Record<AsterNet, number> = { mainnet: 1666, testnet: 714 };
/** `signatureChainId` for EVM main-wallet signatures (agent approval). Same on mainnet and testnet per the docs. */
export const ASTER_EVM_SIGNATURE_CHAIN_ID = 56;

export const MESSAGE_TYPES = { Message: [{ name: "msg", type: "string" }] } as const;

export function asterTypedData(msg: string, chainId: number) {
  return {
    domain: { name: ASTER_DOMAIN_NAME, version: "1", chainId, verifyingContract: zeroAddress as Address },
    types: MESSAGE_TYPES,
    primaryType: "Message" as const,
    message: { msg },
  };
}

/** Same as the full typed data incl. EIP712Domain, as a JSON string: what an `eth_signTypedData_v4` / BAW `--message` needs. */
export function typedDataJson(msg: string, chainId: number): string {
  const t = asterTypedData(msg, chainId);
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...t.types,
    },
    primaryType: t.primaryType,
    domain: t.domain,
    message: t.message,
  });
}

/** Python `urllib.parse.quote_plus` (what Aster's reference client uses): only A-Z a-z 0-9 _ . - ~ stay literal, space → '+'. */
export function quotePlus(v: string): string {
  return encodeURIComponent(v)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** `urlencode(params)` in insertion order. */
export function encodeParams(params: [string, string][]): string {
  return params.map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`).join("&");
}

let lastMicros = 0n;
/** Strictly increasing microsecond nonce (Aster rejects reused nonces and ones > 60 s off server time). */
export function nextNonce(nowMs: number = Date.now()): string {
  let n = BigInt(Math.floor(nowMs)) * 1000n;
  if (n <= lastMicros) n = lastMicros + 1n;
  lastMicros = n;
  return n.toString();
}

export type AgentAuth = { user: Address; signer: Address };

/**
 * The exact string an agent signs for a trading request: business params, then `nonce`, `user`, `signer`.
 * The same string (plus `&signature=`) is the request body, so what is signed is byte-for-byte what is sent.
 */
export function tradeMessage(params: [string, string][], auth: AgentAuth, nonce: string): string {
  return encodeParams([...params, ["nonce", nonce], ["user", auth.user], ["signer", auth.signer]]);
}

export type AgentApproval = {
  user: Address;
  agentName: string;
  agentAddress: Address;
  /** Agent expiry, unix ms. */
  expired: number;
  nonce: string;
};

/** Hard-coded safe scope: perps only, never spot, never withdraw (so no IP whitelist). */
export const AGENT_SCOPE = { canSpotTrade: false, canPerpTrade: true, canWithdraw: false } as const;

/** The literal `msg` the main wallet signs for `registerAndApproveAgent` (field order from the docs). */
export function approvalMessage(a: AgentApproval): string {
  return [
    `user=${a.user}`,
    `nonce=${a.nonce}`,
    `agentName=${a.agentName}`,
    `agentAddress=${a.agentAddress}`,
    `expired=${a.expired}`,
    `signatureChainId=${ASTER_EVM_SIGNATURE_CHAIN_ID}`,
    `canSpotTrade=${AGENT_SCOPE.canSpotTrade}`,
    `canPerpTrade=${AGENT_SCOPE.canPerpTrade}`,
    `canWithdraw=${AGENT_SCOPE.canWithdraw}`,
    `ipWhitelist=`,
  ].join("&");
}

/** Form body for `POST /fapi/v3/registerAndApproveAgent` once the main wallet has signed `approvalMessage`. */
export function approvalBody(a: AgentApproval, signature: Hex): string {
  return encodeParams([
    ["user", a.user],
    ["nonce", a.nonce],
    ["agentName", a.agentName],
    ["agentAddress", a.agentAddress],
    ["expired", String(a.expired)],
    ["signatureChainId", String(ASTER_EVM_SIGNATURE_CHAIN_ID)],
    ["canSpotTrade", String(AGENT_SCOPE.canSpotTrade)],
    ["canPerpTrade", String(AGENT_SCOPE.canPerpTrade)],
    ["canWithdraw", String(AGENT_SCOPE.canWithdraw)],
    ["ipWhitelist", ""],
    ["signature", signature],
  ]);
}

/** Agent names: short, URL-safe, recognisable in the Aster API-wallet list. */
export function defaultAgentName(nowMs: number = Date.now()): string {
  return `towack-${Math.floor(nowMs / 1000).toString(36)}`;
}

export const AGENT_TTL_DAYS = 7;
