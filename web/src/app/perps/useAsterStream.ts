"use client";

import { useEffect, useRef, useState } from "react";
import type { AsterNet } from "@/lib/aster/markets";
import { ASTER_WS } from "@/lib/aster/marketData";

/** live = websocket open and delivering; poll = websocket unavailable, consumers fall back to REST polling. */
export type FeedStatus = "connecting" | "live" | "poll";

const OPEN_TIMEOUT_MS = 6_000;
const RETRY_POLL_MS = 45_000;
const RECONNECT_MS = 1_500;
const MAX_RECONNECTS = 4;

type Listener = (stream: string, data: unknown) => void;

/**
 * One persistent combined-stream socket per Aster network (`<host>/stream`), shared by every terminal on the page.
 * Streams are added / removed with the documented live SUBSCRIBE / UNSUBSCRIBE messages instead of reconnecting:
 * Chrome logs "Close received after close" for every client-initiated close against Aster's servers, so the terminal
 * never closes a healthy socket. Switching symbol or interval just changes subscriptions.
 */
class AsterSocket {
  status: FeedStatus = "connecting";
  host?: string;
  private ws?: WebSocket;
  private subs = new Map<string, number>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private reconnects = 0;
  private id = 0;

  constructor(private net: AsterNet) {
    this.attempt(0);
  }

  private setStatus(s: FeedStatus, host?: string) {
    this.status = s;
    this.host = host;
    this.statusListeners.forEach((l) => l());
  }

  private send(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]) {
    if (!params.length || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ method, params, id: ++this.id }));
  }

  private attempt(i: number): void {
    if (this.timer) clearTimeout(this.timer);
    const hosts = ASTER_WS[this.net];
    if (typeof WebSocket === "undefined" || i >= hosts.length) {
      this.setStatus("poll");
      this.timer = setTimeout(() => this.attempt(0), RETRY_POLL_MS);
      return;
    }
    const host = hosts[i];
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${host}/stream`);
    } catch {
      return this.attempt(i + 1);
    }
    this.ws = ws;
    let opened = false;
    const abandon = () => {
      // Never close mid-handshake (also logs); detach and close quietly once it opens, if it ever does.
      ws.onerror = ws.onclose = ws.onmessage = null;
      ws.onopen = () => ws.close();
    };
    this.timer = setTimeout(() => {
      if (opened) return;
      abandon();
      this.attempt(i + 1);
    }, OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      opened = true;
      this.reconnects = 0;
      if (this.timer) clearTimeout(this.timer);
      this.send("SUBSCRIBE", [...this.subs.keys()]);
      this.setStatus("live", host);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { stream?: string; data?: unknown };
        if (msg && typeof msg.stream === "string") this.listeners.forEach((l) => l(msg.stream!, msg.data));
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => {
      if (opened) return;
      if (this.timer) clearTimeout(this.timer);
      abandon();
      this.attempt(i + 1);
    };
    ws.onclose = () => {
      if (!opened) return;
      // Dropped by the server (24h limit, network blip): poll meanwhile, reconnect, re-subscribe.
      this.setStatus("poll");
      this.timer = this.reconnects++ < MAX_RECONNECTS ? setTimeout(() => this.attempt(i), RECONNECT_MS * this.reconnects) : setTimeout(() => this.attempt(0), RETRY_POLL_MS);
    };
  }

  subscribe(streams: string[], listener: Listener, onStatus: () => void): () => void {
    this.listeners.add(listener);
    this.statusListeners.add(onStatus);
    const added = streams.filter((s) => {
      const n = this.subs.get(s) ?? 0;
      this.subs.set(s, n + 1);
      return n === 0;
    });
    this.send("SUBSCRIBE", added);
    return () => {
      this.listeners.delete(listener);
      this.statusListeners.delete(onStatus);
      const removed = streams.filter((s) => {
        const n = (this.subs.get(s) ?? 1) - 1;
        if (n <= 0) this.subs.delete(s);
        else this.subs.set(s, n);
        return n <= 0;
      });
      this.send("UNSUBSCRIBE", removed);
    };
  }
}

const pool: Partial<Record<AsterNet, AsterSocket>> = {};
const socketFor = (net: AsterNet) => (pool[net] ??= new AsterSocket(net));

/** Subscribe to Aster market streams. Consumers must poll REST whenever status !== "live". */
export function useAsterStream(net: AsterNet, streams: string[], onMessage: (stream: string, data: unknown) => void): { status: FeedStatus; host?: string } {
  const [state, setState] = useState<{ net: AsterNet; status: FeedStatus; host?: string }>({ net, status: "connecting" });
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });
  const key = streams.join("/");

  useEffect(() => {
    if (!key) return;
    const sock = socketFor(net);
    const wanted = new Set(key.split("/"));
    const sync = () => setState({ net, status: sock.status, host: sock.host });
    const unsub = sock.subscribe([...wanted], (stream, data) => wanted.has(stream) && handler.current(stream, data), sync);
    sync();
    return unsub;
  }, [net, key]);

  return state.net === net ? { status: state.status, host: state.host } : { status: "connecting" };
}
