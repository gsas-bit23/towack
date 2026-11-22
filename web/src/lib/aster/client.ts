/**
 * Browser-only Aster client: the user's trade-only API wallet (agent) key, kept in THIS browser's storage, and
 * agent-signed requests sent straight to Aster's API host. Never sent to a Towack server (there is none), never in
 * cookies, never in env. Only the EIP-712 signature leaves the browser.
 */
import { isAddress, isHex, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ASTER_REST, getJson, type AsterNet } from "./markets";
import { ASTER_TRADE_CHAIN_ID, approvalBody, asterTypedData, nextNonce, tradeMessage, type AgentApproval } from "./sign";

export type StoredAgent = {
  v: 1;
  net: AsterNet;
  /** Main (login / deposit) wallet that owns the Aster account. */
  user: Address;
  /** API wallet (agent) address. */
  signer: Address;
  /** API wallet private key: trade-only, can never withdraw (approved with canWithdraw=false). */
  key: Hex;
  /** Agent expiry, unix ms (0 = unknown, e.g. pasted from Aster's API-wallet page). */
  expired: number;
  source: "generated" | "pasted";
  remember: boolean;
};

const storageKey = (net: AsterNet) => `towack.aster.agent.v1.${net}`;

export function parseStoredAgent(raw: string | null, net: AsterNet): StoredAgent | undefined {
  if (!raw) return undefined;
  try {
    const a = JSON.parse(raw) as Partial<StoredAgent>;
    if (a.v !== 1 || a.net !== net || !a.user || !a.signer || !a.key) return undefined;
    if (!isAddress(a.user) || !isAddress(a.signer) || !isHex(a.key) || a.key.length !== 66) return undefined;
    return { ...a, user: getAddress(a.user), signer: getAddress(a.signer) } as StoredAgent;
  } catch {
    return undefined;
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** For useSyncExternalStore: re-read when this tab saves/forgets, or another tab changes localStorage. */
export function subscribeAgent(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Raw stored JSON (session first, then local). Strings are stable snapshots for useSyncExternalStore. */
export function agentSnapshot(net: AsterNet): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(net)) ?? window.localStorage.getItem(storageKey(net));
  } catch {
    return null;
  }
}

export function saveAgent(a: StoredAgent) {
  const k = storageKey(a.net);
  window.sessionStorage.removeItem(k);
  window.localStorage.removeItem(k);
  (a.remember ? window.localStorage : window.sessionStorage).setItem(k, JSON.stringify(a));
  emit();
}

export function forgetAgent(net: AsterNet) {
  const k = storageKey(net);
  window.sessionStorage.removeItem(k);
  window.localStorage.removeItem(k);
  emit();
}

/** Validate a pasted API-wallet private key and return its address. */
export function agentAddressFromKey(key: string): Address | undefined {
  const k = key.trim();
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  try {
    return privateKeyToAccount(hex).address;
  } catch {
    return undefined;
  }
}

export function normaliseKey(key: string): Hex {
  const k = key.trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

/** One agent-signed request (TRADE / USER_DATA). Params are signed and sent as the exact same string. */
export async function signedRequest(agent: StoredAgent, method: "GET" | "POST" | "DELETE", path: string, params: [string, string][] = []): Promise<unknown> {
  const account = privateKeyToAccount(agent.key);
  const msg = tradeMessage(params, { user: agent.user, signer: agent.signer }, nextNonce());
  const signature = await account.signTypedData(asterTypedData(msg, ASTER_TRADE_CHAIN_ID[agent.net]));
  const body = `${msg}&signature=${signature}`;
  const url = `${ASTER_REST[agent.net]}${path}`;
  if (method === "GET") return getJson(`${url}?${body}`);
  return getJson(url, { method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
}

/** `POST /fapi/v3/registerAndApproveAgent` (public endpoint; authorised only by the main wallet's signature). */
export async function registerAgent(net: AsterNet, approval: AgentApproval, signature: Hex): Promise<unknown> {
  return getJson(`${ASTER_REST[net]}/fapi/v3/registerAndApproveAgent`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: approvalBody(approval, signature),
  });
}

/** Turn Aster's deposit-gate error into plain words. */
export function explainAsterError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("-5050")) return "Aster only enables trading API calls after this main wallet has made a deposit on Aster. Deposit on asterdex.com first, then retry.";
  if (m.includes("No agent found")) return "Aster doesn't know this API wallet for this account (expired, deleted, or wrong network). Forget it and set up a new one.";
  return m;
}
