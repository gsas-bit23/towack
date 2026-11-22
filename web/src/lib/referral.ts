"use client";

import { useEffect, useState } from "react";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";

/**
 * Off-chain referral plumbing. The contract only knows referrer ADDRESSES (`mint(address referrer)`); `.ai` handles
 * are display labels carried in the URL (`/r/<handle>?ref=<address>`, `/mint?ref=<address>&handle=<handle>`). There
 * is no on-chain SPACE ID resolver: the `ref` query param is the source of truth.
 */

export type Referral = { address?: Address; handle?: string };

/** Checksummed non-zero 0x address, or undefined. */
export function parseRefAddress(v: string | null | undefined): Address | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!isAddress(t, { strict: false })) return undefined;
  const a = getAddress(t);
  return a === zeroAddress ? undefined : a;
}

/** Normalises a `.ai` handle for display: lowercase, no leading @, safe chars only, ".ai" suffix. */
export function normalizeHandle(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  let h = decodeURIComponentSafe(v).trim().toLowerCase().replace(/^@+/, "");
  h = h.replace(/[^a-z0-9._-]/g, "").replace(/\.ai$/, "").replace(/^\.+|\.+$/g, "");
  if (!h || h.length > 48) return undefined;
  return `${h}.ai`;
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Label for a referrer: "name.ai (0x1234…abcd)" or just the short address. */
export function referralLabel(r: Referral): string | undefined {
  if (!r.address) return undefined;
  return r.handle ? `${r.handle} (${shortAddr(r.address)})` : shortAddr(r.address);
}

/** Share link for a referrer. With a handle: /r/<handle>?ref=<address>; without: /mint?ref=<address>. */
export function referralLink(origin: string, address: Address, handle?: string): string {
  return handle ? `${origin}/r/${encodeURIComponent(handle)}?ref=${address}` : `${origin}/mint?ref=${address}`;
}

/** Where a friend's CTA goes: the paid mint with the referrer baked into the query. */
export function mintHref(r: Referral): string {
  if (!r.address) return "/mint";
  const q = new URLSearchParams({ ref: r.address });
  if (r.handle) q.set("handle", r.handle);
  return `/mint?${q.toString()}`;
}

/** Reads `ref` / `handle` from the current URL (and the handle from a /r/<handle> path). Client-only. */
export function useReferralFromUrl(): Referral {
  const [r, setR] = useState<Referral>({});
  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(window.location.search);
      const path = window.location.pathname.match(/^\/r\/([^/]+)/);
      setR({ address: parseRefAddress(q.get("ref")), handle: normalizeHandle(q.get("handle") ?? path?.[1]) });
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return r;
}
