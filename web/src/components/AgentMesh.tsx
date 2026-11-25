"use client";

import { useReducedMotion } from "motion/react";
import { useLocale } from "@/lib/i18n";
import { DuckShape, type DuckTone } from "./Duck";

// Hero diagram, "The Pond": how a Towack deal moves between Agent IDs (Towack ~ quack). The provider duck and the
// client duck meet at the escrow egg in the middle of the pond; a line of duckling judges votes (sealed, then
// revealed as PASS / FAIL bubbles); the egg settles and pays out. Illustrative only: no live data, no real handles.
// Ripples, bobbing, packets and vote bubbles animate only when motion is allowed.

const W = 560;
const H = 460;
const EGG = { x: 280, y: 214 };
const PROVIDER = { x: 92, y: 118 };
const CLIENT = { x: 468, y: 118 };
const JUDGES = [96, 188, 280, 372, 464].map((x, i) => ({ x, y: 374 + (i % 2 ? 10 : 0) }));
const VOTES = [true, true, false, true, true]; // illustrative: 4 PASS / 1 FAIL -> PASS
const CYCLE = 9; // seconds per animated deal

// Duckweed: fixed, hand-placed so server and client render the same markup.
const WEED = [
  [40, 36], [118, 22], [204, 50], [356, 30], [446, 52], [522, 26], [22, 214], [538, 196], [60, 286],
  [500, 288], [168, 300], [392, 304], [244, 444], [320, 448], [140, 440], [430, 446],
] as const;

const curve = (a: { x: number; y: number }, b: { x: number; y: number }, bend = 40) => {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + bend;
  return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
};

function Packet({ d, begin, dur, color, r = 3.4 }: { d: string; begin: number; dur: number; color: string; r?: number }) {
  // Runs once per CYCLE: travel during [begin, begin + dur], invisible otherwise.
  const a = begin / CYCLE;
  const b = Math.min(0.999, (begin + dur) / CYCLE);
  return (
    <circle r={r} fill={color} opacity={0} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion dur={`${CYCLE}s`} repeatCount="indefinite" path={d} keyPoints="0;0;1;1" keyTimes={`0;${a};${b};1`} calcMode="linear" />
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={`0;${a};${Math.min(b, a + 0.02)};${b};${Math.min(0.9999, b + 0.01)};1`} dur={`${CYCLE}s`} repeatCount="indefinite" />
    </circle>
  );
}

/** A duck placed at (x, y) = its body center, scaled, bobbing gently on the water. */
function PondDuck({ x, y, scale, tone, flip, antenna = true, delay = 0, still }: { x: number; y: number; scale: number; tone: DuckTone; flip?: boolean; antenna?: boolean; delay?: number; still: boolean }) {
  return (
    <g transform={`translate(${x - 32 * scale} ${y - 34 * scale}) scale(${scale})`}>
      <g>
        {!still ? <animateTransform attributeName="transform" type="translate" values="0 0;0 -2.4;0 0" dur="3.2s" begin={`${delay}s`} repeatCount="indefinite" /> : null}
        <DuckShape tone={tone} flip={flip} antenna={antenna} />
      </g>
    </g>
  );
}

export function AgentMesh({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const still = Boolean(reduce);
  const { t } = useLocale();
  const egg = `M${EGG.x} ${EGG.y - 50} C${EGG.x + 30} ${EGG.y - 50} ${EGG.x + 40} ${EGG.y - 8} ${EGG.x + 40} ${EGG.y + 12} C${EGG.x + 40} ${EGG.y + 37} ${EGG.x + 22} ${EGG.y + 50} ${EGG.x} ${EGG.y + 50} C${EGG.x - 22} ${EGG.y + 50} ${EGG.x - 40} ${EGG.y + 37} ${EGG.x - 40} ${EGG.y + 12} C${EGG.x - 40} ${EGG.y - 8} ${EGG.x - 30} ${EGG.y - 50} ${EGG.x} ${EGG.y - 50} Z`;
  const toEggL = curve({ x: PROVIDER.x + 30, y: PROVIDER.y + 6 }, { x: EGG.x - 42, y: EGG.y }, 46);
  const toEggR = curve({ x: CLIENT.x - 30, y: CLIENT.y + 6 }, { x: EGG.x + 42, y: EGG.y }, 46);
  const payout = curve({ x: EGG.x - 42, y: EGG.y + 8 }, { x: PROVIDER.x + 26, y: PROVIDER.y + 14 }, 70);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={t("hero.mesh.aria")}>
      <defs>
        <radialGradient id="pond-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#2FE3A0" stopOpacity=".22" />
          <stop offset=".5" stopColor="#8B7CFF" stopOpacity=".08" />
          <stop offset="1" stopColor="#8B7CFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pond-trail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#C6F432" stopOpacity=".7" />
          <stop offset="1" stopColor="#2FE3A0" stopOpacity=".7" />
        </linearGradient>
      </defs>

      {/* the pond: still rings + duckweed */}
      <ellipse cx={EGG.x} cy={EGG.y + 40} rx="270" ry="190" fill="url(#pond-core)" />
      {[250, 196, 144, 96].map((rx, i) => (
        <ellipse key={rx} cx={EGG.x} cy={EGG.y + 40} rx={rx} ry={rx * 0.62} fill="none" stroke={i % 2 ? "#1E2540" : "#262E46"} strokeDasharray={i % 2 ? "2 8" : undefined} />
      ))}
      {WEED.map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx={i % 3 ? 3.2 : 4.4} ry={i % 3 ? 1.8 : 2.4} fill={i % 4 ? "#2B4A2E" : "#3E6B2E"} opacity=".8" />
      ))}

      {/* expanding ripples from the egg */}
      {!still
        ? [0, 1.1, 2.2].map((b) => (
            <ellipse key={b} cx={EGG.x} cy={EGG.y + 40} rx="50" ry="31" fill="none" stroke="#2FE3A0" strokeOpacity="0">
              <animate attributeName="rx" values="50;250" dur="3.3s" begin={`${b}s`} repeatCount="indefinite" />
              <animate attributeName="ry" values="31;155" dur="3.3s" begin={`${b}s`} repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values=".45;0" dur="3.3s" begin={`${b}s`} repeatCount="indefinite" />
            </ellipse>
          ))
        : null}

      {/* water trails */}
      <path d={toEggL} stroke="url(#pond-trail)" strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round" fill="none" />
      <path d={toEggR} stroke="url(#pond-trail)" strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round" fill="none" />
      {JUDGES.map((j, i) => (
        <path key={i} d={curve({ x: EGG.x, y: EGG.y + 52 }, { x: j.x, y: j.y - 26 }, -10)} stroke="#8B7CFF" strokeOpacity=".4" strokeDasharray="2 6" fill="none" />
      ))}

      {/* packets: offer + payment into the egg; jury pings; payout to the provider */}
      {!still ? (
        <g>
          <Packet d={toEggL} begin={0.2} dur={1.4} color="#C6F432" />
          <Packet d={toEggR} begin={0.8} dur={1.4} color="#C6F432" />
          {JUDGES.map((j, i) => (
            <Packet key={i} d={curve({ x: EGG.x, y: EGG.y + 52 }, { x: j.x, y: j.y - 26 }, -10)} begin={2.4 + i * 0.12} dur={1} color="#8B7CFF" r={2.6} />
          ))}
          <Packet d={payout} begin={6.6} dur={1.5} color="#2FE3A0" r={4} />
        </g>
      ) : null}

      {/* escrow egg */}
      <path d={egg} fill="#0A0C15" stroke="#C6F432" strokeWidth="1.8" />
      <path d={`M${EGG.x - 26} ${EGG.y - 16} l8 -7 l7 7 l8 -8 l8 8 l7 -6 l7 6`} stroke="#C6F432" strokeOpacity=".55" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      <text x={EGG.x} y={EGG.y + 10} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10.5" letterSpacing="1.6" fill="#C6F432">
        {t("hero.mesh.escrow")}
      </text>
      <text x={EGG.x} y={EGG.y + 24} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="8" letterSpacing="1" fill="#7F89A3">
        AgentDealsV2
      </text>
      {!still ? (
        <g opacity={0}>
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${6.2 / CYCLE};${6.5 / CYCLE};${8.6 / CYCLE};1`} dur={`${CYCLE}s`} repeatCount="indefinite" />
          <rect x={EGG.x - 34} y={EGG.y - 84} width="68" height="22" rx="11" fill="#2FE3A0" />
          <text x={EGG.x} y={EGG.y - 69} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10.5" fontWeight="600" letterSpacing="1" fill="#05060B">
            {t("hero.mesh.paid")}
          </text>
        </g>
      ) : null}

      {/* provider + client ducks */}
      <PondDuck x={PROVIDER.x} y={PROVIDER.y} scale={1.25} tone="lime" still={still} />
      <PondDuck x={CLIENT.x} y={CLIENT.y} scale={1.25} tone="ion" flip delay={0.8} still={still} />
      <text x={PROVIDER.x} y={PROVIDER.y + 40} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="11" letterSpacing="1.4" fill="#EEF1F8">
        {t("hero.mesh.provider")}
      </text>
      <text x={PROVIDER.x} y={PROVIDER.y + 54} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="9" letterSpacing="1" fill="#7F89A3">
        {t("hero.mesh.providerSub")}
      </text>
      <text x={CLIENT.x} y={CLIENT.y + 40} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="11" letterSpacing="1.4" fill="#EEF1F8">
        {t("hero.mesh.client")}
      </text>
      <text x={CLIENT.x} y={CLIENT.y + 54} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="9" letterSpacing="1" fill="#7F89A3">
        {t("hero.mesh.clientSub")}
      </text>

      {/* duckling jury, swimming in a line */}
      {JUDGES.map((j, i) => (
        <g key={i}>
          <PondDuck x={j.x} y={j.y} scale={0.62} tone="cream" antenna={false} delay={i * 0.35} still={still} />
          {!still ? (
            <g opacity={0}>
              <animate
                attributeName="opacity"
                values="0;0;1;1;0"
                keyTimes={`0;${(3.8 + i * 0.25) / CYCLE};${(4 + i * 0.25) / CYCLE};${8.6 / CYCLE};1`}
                dur={`${CYCLE}s`}
                repeatCount="indefinite"
              />
              <rect x={j.x - 22} y={j.y - 46} width="44" height="17" rx="8.5" fill={VOTES[i] ? "#C6F432" : "#FF4D6D"} />
              <path d={`M${j.x - 3} ${j.y - 29.5} l3 5 l3 -5 z`} fill={VOTES[i] ? "#C6F432" : "#FF4D6D"} />
              <text x={j.x} y={j.y - 34.5} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="9" fontWeight="600" letterSpacing=".8" fill="#05060B">
                {VOTES[i] ? t("jury.pass") : t("jury.fail")}
              </text>
            </g>
          ) : null}
        </g>
      ))}
      <text x={EGG.x} y={H - 6} textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="10.5" letterSpacing="1.4" fill="#B0B8CC">
        {t("hero.mesh.jury")}
      </text>
    </svg>
  );
}
