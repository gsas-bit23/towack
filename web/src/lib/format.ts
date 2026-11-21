import { formatUnits } from "viem";

export function fmtNum(n: number, maxFrac = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

/** Format an 18-decimal bigint (BNB or TWAK) with sensible precision. */
export function fmt18(v: bigint | undefined, maxFrac = 4): string {
  if (v === undefined) return "—";
  const s = formatUnits(v, 18);
  const [i, f = ""] = s.split(".");
  const int = BigInt(i).toLocaleString("en-US");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export function fmtDate(sec: bigint | number | undefined): string {
  if (sec === undefined) return "—";
  const n = Number(sec);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export function shortAddr(a: string | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}
