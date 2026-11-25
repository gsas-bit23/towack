"use client";

import type { Address, Hex } from "viem";
import { SIGN_IN_DOMAIN, SIGN_IN_TYPES, type SignInMessage } from "./signin";

/** Browser client for /api/exchange. The session token lives in sessionStorage (this tab only), never in a URL. */

const KEY = "towack.exchange.session.v1";
const listeners = new Set<() => void>();

export type Session = { token: string; handle: string; agentId: string; wallet: string };

export function loadSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: session lasts until reload */
  }
  listeners.forEach((l) => l());
}

export function subscribeSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function signOut() {
  saveSession(null);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.auth) {
    const s = loadSession();
    if (!s) throw new ApiError("Sign in first", 401);
    headers.set("Authorization", `Bearer ${s.token}`);
  }
  const res = await fetch(`/api/exchange${path}`, { ...init, headers, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 401 && init.auth) saveSession(null);
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return data;
}

type SignTypedData = (args: {
  domain: typeof SIGN_IN_DOMAIN;
  types: typeof SIGN_IN_TYPES;
  primaryType: "SignIn";
  message: { wallet: Address; nonce: string; issuedAt: bigint; statement: string };
}) => Promise<Hex>;

/** Agent ID sign-in with the connected browser wallet: nonce → EIP-712 signature → session. */
export async function signIn(wallet: Address, signTypedData: SignTypedData): Promise<Session> {
  const { message } = await api<{ message: SignInMessage }>("/auth/nonce", { method: "POST", body: JSON.stringify({ wallet }) });
  const signature = await signTypedData({
    domain: SIGN_IN_DOMAIN,
    types: SIGN_IN_TYPES,
    primaryType: "SignIn",
    message: { ...message, issuedAt: BigInt(message.issuedAt) },
  });
  const out = await api<{ token: string; agent: { agentId: string; handle: string } }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature }),
  });
  const s: Session = { token: out.token, handle: `${out.agent.handle}.ai`, agentId: out.agent.agentId, wallet };
  saveSession(s);
  return s;
}

export type Service = { title: string; description: string; priceUsdt?: string };
export type PublicAgent = { handle: string; agentId: string; bio: string; services: Service[]; listed: boolean; lastSeen: string };
export type Message = { id: string; from: string; to: string; kind: string; body: string; dealId: string | null; createdAt: string; read: boolean };
export type Stats = { agents: number; listed: number; messages: number; messages24h: number; activeAgents24h: number };
