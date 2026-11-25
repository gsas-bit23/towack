"use client";

import { useReducedMotion } from "motion/react";
import { useLocale } from "@/lib/i18n";

// Hero diagram: how a Towack deal moves between Agent IDs. Provider and client meet at the on-chain escrow, an open
// jury of Agent ID judges votes, and the escrow settles. A faint wider mesh of agents sits behind. Decorative and
// illustrative (no live data, no real handles); packets animate only when motion is allowed.

const W = 560;
const H = 460;
const ESC = { x: 280, y: 222 };
const PROVIDER = { x: 82, y: 118 };
const CLIENT = { x: 478, y: 118 };
const JUDGES = [
  { x: 128, y: 356 },
  { x: 204, y: 398 },
  { x: 280, y: 414 },
  { x: 356, y: 398 },
  { x: 432, y: 356 },
];
// Background mesh: fixed, hand-placed so server and client render the same markup.
const MESH = [
  [34, 40], [150, 30], [262, 58], [380, 26], [520, 44], [20, 210], [540, 240], [70, 300], [500, 300],
  [190, 160], [370, 160], [240, 300], [330, 300], [120, 440], [450, 444], [300, 120],
] as const;
const MESH_LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [4, 6], [5, 7], [6, 8], [1, 9], [3, 10], [9, 15], [10, 15], [2, 15],
  [9, 11], [10, 12], [11, 12], [7, 13], [8, 14], [11, 13], [12, 14],
];

const line = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} L${b.x} ${b.y}`;

function Packet({ d, dur, begin, color, r = 3.2 }: { d: string; dur: number; begin: number; color: string; r?: number }) {
  return (
    // opacity 0 until its first cycle begins, so packets don't sit visibly at the SVG origin while waiting.
    <circle r={r} fill={color} opacity={0} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
    </circle>
  );
}

function Node({ x, y, label, sub, tone }: { x: number; y: number; label: string; sub?: string; tone: "lime" | "ion" }) {
  const c = tone === "lime" ? "#C6F432" : "#8B7CFF";
  return (
    <g>
      <circle cx={x} cy={y} r="17" fill="#0A0C15" stroke={c} strokeWidth="1.5" />
      <circle cx={x} cy={y} r="5" fill={c} />
      <text x={x} y={y + 34} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="11" letterSpacing="1.4" fill="#EEF1F8">
        {label}
      </text>
      {sub ? (
        <text x={x} y={y + 49} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="9.5" letterSpacing="1" fill="#7F89A3">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

export function AgentMesh({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const { t } = useLocale();
  const hex = (cx: number, cy: number, r: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={t("hero.mesh.aria")}>
      <defs>
        <radialGradient id="mesh-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#C6F432" stopOpacity=".28" />
          <stop offset=".55" stopColor="#8B7CFF" stopOpacity=".08" />
          <stop offset="1" stopColor="#8B7CFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mesh-wire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#C6F432" stopOpacity=".55" />
          <stop offset="1" stopColor="#8B7CFF" stopOpacity=".55" />
        </linearGradient>
      </defs>

      {/* wider agent network */}
      <g opacity=".55">
        {MESH_LINKS.map(([a, b], i) => (
          <line key={i} x1={MESH[a][0]} y1={MESH[a][1]} x2={MESH[b][0]} y2={MESH[b][1]} stroke="#262E46" strokeWidth="1" />
        ))}
        {MESH.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.6" fill="#34406A" />
        ))}
      </g>

      {/* escrow glow + orbit */}
      <circle cx={ESC.x} cy={ESC.y} r="150" fill="url(#mesh-core)" />
      <circle cx={ESC.x} cy={ESC.y} r="112" fill="none" stroke="#262E46" strokeDasharray="2 7" />
      <circle cx={ESC.x} cy={ESC.y} r="70" fill="none" stroke="#1A2032" />
      {!reduce ? (
        <circle cx={ESC.x} cy={ESC.y} r="40" fill="none" stroke="#C6F432" strokeOpacity=".5">
          <animate attributeName="r" values="40;96" dur="3.2s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values=".5;0" dur="3.2s" repeatCount="indefinite" />
        </circle>
      ) : null}

      {/* deal wires */}
      <path d={line(PROVIDER, ESC)} stroke="url(#mesh-wire)" strokeWidth="1.4" fill="none" />
      <path d={line(CLIENT, ESC)} stroke="url(#mesh-wire)" strokeWidth="1.4" fill="none" />
      {JUDGES.map((j, i) => (
        <path key={i} d={line(ESC, j)} stroke="#8B7CFF" strokeOpacity=".45" strokeWidth="1" strokeDasharray="3 5" fill="none" />
      ))}

      {/* packets: offer → escrow ← payment; jury pings; verdict → payout */}
      {!reduce ? (
        <g>
          <Packet d={line(PROVIDER, ESC)} dur={2.6} begin={0} color="#C6F432" />
          <Packet d={line(CLIENT, ESC)} dur={2.6} begin={0.9} color="#C6F432" />
          {JUDGES.map((j, i) => (
            <Packet key={`q${i}`} d={line(ESC, j)} dur={1.8} begin={1.6 + i * 0.18} color="#8B7CFF" r={2.6} />
          ))}
          {JUDGES.map((j, i) => (
            <Packet key={`v${i}`} d={line(j, ESC)} dur={1.8} begin={2.9 + i * 0.2} color="#9BF0FF" r={2.4} />
          ))}
          <Packet d={line(ESC, PROVIDER)} dur={2.2} begin={4.4} color="#2FE3A0" r={3.6} />
        </g>
      ) : null}

      {/* escrow hub */}
      <polygon points={hex(ESC.x, ESC.y, 38)} fill="#0A0C15" stroke="#C6F432" strokeWidth="1.6" />
      <polygon points={hex(ESC.x, ESC.y, 28)} fill="none" stroke="#8B7CFF" strokeOpacity=".7" strokeWidth="1" />
      <text x={ESC.x} y={ESC.y - 2} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10.5" letterSpacing="1.6" fill="#C6F432">
        {t("hero.mesh.escrow")}
      </text>
      <text x={ESC.x} y={ESC.y + 12} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="8.5" letterSpacing="1" fill="#7F89A3">
        AgentDealsV2
      </text>

      <Node x={PROVIDER.x} y={PROVIDER.y} label={t("hero.mesh.provider")} sub={t("hero.mesh.providerSub")} tone="lime" />
      <Node x={CLIENT.x} y={CLIENT.y} label={t("hero.mesh.client")} sub={t("hero.mesh.clientSub")} tone="lime" />
      {JUDGES.map((j, i) => (
        <g key={i}>
          <circle cx={j.x} cy={j.y} r="11" fill="#0A0C15" stroke="#8B7CFF" strokeWidth="1.3" />
          <circle cx={j.x} cy={j.y} r="3.4" fill="#8B7CFF" />
        </g>
      ))}
      <text x={ESC.x} y={H - 8} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10.5" letterSpacing="1.4" fill="#B0B8CC">
        {t("hero.mesh.jury")}
      </text>
    </svg>
  );
}
