"use client";

import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { keccak256, toBytes } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { towackGenesisAbi } from "@/abi";
import { useTowack } from "@/lib/chain";
import { agentNftAbi, useGenesisDemo, useGenesisState, useMyGenesis } from "@/lib/genesis";
import { GENESIS_BASE, GENESIS_NO_BONUS_ID, GENESIS_PRIZES, GENESIS_SLICES, genesisPrizeById, genesisShareText } from "@/lib/genesisPrizes";
import { fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useVrfFee } from "@/lib/vrfFee";
import { AnimatedNumber, Confetti, ProgressFill, SuccessCheck } from "./motion";
import { ShareButton, useWheelMachine, type WheelStatus } from "./PrizeBooth";
import { SpinWheel } from "./SpinWheel";
import { ConnectPill } from "./ConnectPill";
import { AgentPathToggle } from "./AgentPath";
import { TxNotice, VrfSource } from "./status";
import { Button, Check, Kicker, Panel, Pill } from "./ui";

const WHEEL_SIZE = 380;
const BASE_TEXT = `${GENESIS_BASE.toLocaleString("en-US")} TWAK`;

/** Genesis-only wheel + result card (7 TWAK tiers, no BNB slices). */
function GenesisWheelStage({
  status,
  prizeId,
  salt = 0,
  fresh = false,
  demo = false,
  waitingNote,
  actions,
  idleNote,
}: {
  status: WheelStatus;
  prizeId?: number;
  salt?: number;
  fresh?: boolean;
  demo?: boolean;
  waitingNote?: ReactNode;
  actions?: ReactNode;
  idleNote?: ReactNode;
}) {
  const { mode, landed, burst, onLanded } = useWheelMachine(status, fresh, prizeId, GENESIS_NO_BONUS_ID);
  const prize = genesisPrizeById(prizeId);
  const showResult = landed && prize !== undefined && status === "assigned";

  return (
    <div className="relative">
      {demo ? (
        <div className="mb-4 flex justify-center">
          <Pill tone="gold" className="border border-line text-[13px]">
            DEMO SPIN · not a real mint or prize
          </Pill>
        </div>
      ) : null}
      <div className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 overflow-hidden rounded-2xl" aria-hidden="true">
        <Confetti fire={burst} big={Boolean(prize?.jackpot)} />
      </div>
      <SpinWheel mode={mode} prizeId={prizeId} salt={salt} onLanded={onLanded} size={WHEEL_SIZE} prizes={GENESIS_PRIZES} slices={GENESIS_SLICES} />

      <div className="mt-6 min-h-[110px]" aria-live="polite">
        {status === "waiting" || (status === "assigned" && !landed) ? (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 text-[18px] font-semibold sm:text-[20px]">
              <span className="blink h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
              {status === "waiting" ? "Spinning… waiting for VRF" : "Here it comes…"}
            </div>
            {waitingNote ? <div className="mt-2 text-[14px] text-sub">{waitingNote}</div> : null}
          </div>
        ) : showResult ? (
          <motion.div
            initial={{ y: 12, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className={`rounded-2xl border px-5 py-5 text-center ${prize.kind === "none" ? "border-line bg-card-2" : prize.jackpot ? "gold-hairline border-gold/40 bg-gold/[.06]" : "border-line-2 bg-card-2"}`}
          >
            {prize.kind !== "none" && !demo ? <SuccessCheck className="mx-auto mb-2 h-9 w-9" /> : null}
            <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">{demo ? "Demo landed on" : prize.kind === "none" ? "The wheel says" : "You pulled"}</div>
            <div className={`mt-1 text-[26px] font-semibold leading-tight tracking-tight sm:text-[28px] ${prize.jackpot ? "text-gold" : ""}`}>{prize.label}</div>
            <div className="mt-1 text-[18px] font-semibold">{prize.total.toLocaleString("en-US")} TWAK total</div>
            <div className="mt-1 text-sm font-medium text-muted">
              {prize.kind === "none" ? `No bonus slot. Your ${BASE_TEXT} base is already in your wallet.` : `${BASE_TEXT} base (already sent) + ${prize.extra.toLocaleString("en-US")} TWAK to claim`}
            </div>
            {actions ? <div className="mt-4 flex flex-wrap justify-center gap-3">{actions}</div> : null}
          </motion.div>
        ) : (
          <div className="text-center font-medium text-sub">{idleNote}</div>
        )}
      </div>
    </div>
  );
}

const DEMO_PRIZES = [1, 3, GENESIS_NO_BONUS_ID, 0, 4];

function GenesisDemoWheel() {
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState<WheelStatus>("waiting");
  useEffect(() => {
    const t = setTimeout(() => setStatus("assigned"), 2800);
    return () => clearTimeout(t);
  }, [round]);
  return (
    <GenesisWheelStage
      key={round}
      status={status}
      prizeId={DEMO_PRIZES[(round - 1) % DEMO_PRIZES.length]}
      salt={round}
      fresh
      demo
      waitingNote="Demo only — no transaction, no VRF."
      actions={
        <Button
          tone="line"
          size="sm"
          className="min-h-11"
          onClick={() => {
            setStatus("waiting");
            setRound((r) => r + 1);
          }}
        >
          Spin the demo again
        </Button>
      }
    />
  );
}

/** Live wheel for the connected wallet's Genesis ticket. */
function MyGenesisWheel({ fresh, retryDelay }: { fresh: boolean; retryDelay: number }) {
  const { chainId, addresses, account } = useTowack();
  const { prize, mintIndex, requestedAt } = useMyGenesis();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const now = useNow(5_000);
  const genesis = addresses.genesis;
  const status: WheelStatus = !prize?.minted ? "none" : prize.assigned ? "assigned" : "waiting";
  const canRetry = status === "waiting" && now > 0 && requestedAt !== undefined && requestedAt > 0 && now >= requestedAt + retryDelay;
  const hasExtra = Boolean(prize && prize.extra > 0n);
  const vrf = useVrfFee(genesis, chainId); // a retry is a new VRF request: the caller pays its fee

  const claim = () =>
    genesis && tx.run("Claim Genesis bonus", () => writeContractAsync({ address: genesis, abi: towackGenesisAbi, functionName: "claim", chainId }));
  const retry = () =>
    genesis &&
    account &&
    vrf.value !== undefined &&
    tx.run("Retry VRF", () =>
      writeContractAsync({ address: genesis, abi: towackGenesisAbi, functionName: "retryPrize", args: [account], value: vrf.value, chainId }),
    );

  return (
    <div>
      <GenesisWheelStage
        status={status}
        prizeId={prize?.assigned ? prize.prizeId : undefined}
        salt={mintIndex ?? 0}
        fresh={fresh}
        waitingNote={
          <>
            {mintIndex ? <Pill tone="neutral">GENESIS #{mintIndex}</Pill> : null} {requestedAt && now ? `Requested ${fmtDuration(now - requestedAt)} ago.` : ""}
            {canRetry ? (
              <div className="mt-3 flex justify-center">
                <Button tone="line" size="sm" className="min-h-11" disabled={tx.busy || vrf.value === undefined} onClick={retry}>
                  {vrf.supported === false ? "Retry VRF request" : `Retry VRF request (+${vrf.label} VRF fee)`}
                </Button>
              </div>
            ) : null}
          </>
        }
        actions={
          prize && status === "assigned" ? (
            <>
              {hasExtra && !prize.claimed ? (
                <Button tone="gold" size="sm" className="min-h-11" disabled={tx.busy} onClick={claim}>
                  {tx.busy ? "Check your wallet…" : "Claim bonus TWAK"}
                </Button>
              ) : null}
              {hasExtra && prize.claimed ? <Pill tone="gold" className="border border-line px-4 py-2 text-sm">CLAIMED ✓</Pill> : null}
              <ShareButton prizeId={prize.prizeId} text={genesisShareText(prize.prizeId)} />
            </>
          ) : undefined
        }
      />
      <TxNotice state={tx.state} onClose={tx.reset} />
      {status === "assigned" && hasExtra && !prize?.claimed ? <AgentPathToggle flow="genesisClaim" className="mt-4" /> : null}
    </div>
  );
}

/** Parse numeric token id, 0x hex id, or SPACE ID handle (e.g. "alice" / "alice.ai" -> keccak256(bytes("alice"))). */
function parseTokenOrHandle(raw: string): { id?: bigint; handle?: string } {
  const t = raw.trim();
  if (!t) return {};
  if (/^\d+$/.test(t)) return { id: BigInt(t) };
  if (/^0x[0-9a-fA-F]{1,64}$/.test(t)) return { id: BigInt(t) };
  const bare = t.toLowerCase().replace(/^@+/, "").replace(/\.ai$/, "");
  if (/^[a-z0-9]{1,64}$/.test(bare)) return { id: BigInt(keccak256(toBytes(bare))), handle: bare };
  return {};
}

/** Mint CTA: finds (or takes) the Agent ID handle / token id, checks it, and calls mint(tokenId). */
function GenesisClaim({ onMinted }: { onMinted: () => void }) {
  const { chainId, addresses, account } = useTowack();
  const { genesis, isOpen, mintCount, cap, registry } = useGenesisState();
  const { prize } = useMyGenesis();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [typed, setTyped] = useState("");
  const reg = registry ?? addresses.agentId;

  // Mainnet SPACE ID HandleRegistry exposes handleOf(address) where tokenId = keccak256(bytes(handle)).
  const { data: autoHandle } = useReadContract({
    address: reg,
    abi: agentNftAbi,
    functionName: "handleOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(reg && account && registry), retry: false },
  });
  // Agent ID registries that implement ERC721Enumerable expose tokenOfOwnerByIndex.
  const { data: enumAutoId } = useReadContract({
    address: reg,
    abi: agentNftAbi,
    functionName: "tokenOfOwnerByIndex",
    args: account ? [account, 0n] : undefined,
    chainId,
    query: { enabled: Boolean(reg && account && registry && !autoHandle), retry: false },
  });
  const handleAutoId = autoHandle && autoHandle.length > 0 ? BigInt(keccak256(toBytes(autoHandle))) : undefined;
  const autoId = handleAutoId ?? enumAutoId;
  const parsed = parseTokenOrHandle(typed);
  const tokenId = typed.trim() !== "" ? parsed.id : autoId;
  const displayId =
    typed.trim() !== ""
      ? parsed.handle
        ? `${parsed.handle}.ai`
        : tokenId !== undefined
          ? `#${tokenId.toString().length > 12 ? `${tokenId.toString().slice(0, 8)}…` : tokenId.toString()}`
          : undefined
      : autoHandle
        ? `${autoHandle}.ai`
        : autoId !== undefined
          ? `#${autoId.toString()}`
          : undefined;
  const { data: owner, isError: ownerErr } = useReadContract({
    address: reg,
    abi: agentNftAbi,
    functionName: "ownerOf",
    args: tokenId !== undefined ? [tokenId] : undefined,
    chainId,
    query: { enabled: Boolean(reg && registry && tokenId !== undefined), retry: false },
  });
  const { data: used } = useReadContract({
    address: genesis,
    abi: towackGenesisAbi,
    functionName: "tokenIdUsed",
    args: tokenId !== undefined ? [tokenId] : undefined,
    chainId,
    query: { enabled: Boolean(genesis && tokenId !== undefined) },
  });

  const owns = tokenId === undefined ? undefined : ownerErr ? false : owner === undefined ? undefined : owner.toLowerCase() === account?.toLowerCase();
  const minted = prize?.minted;
  const soldOut = mintCount !== undefined ? mintCount >= cap : undefined;
  // No mint price. The only BNB sent is the Chainlink VRF fee for the spin (excess refunded in the same tx).
  const vrf = useVrfFee(genesis, chainId);
  const canMint = Boolean(
    genesis && account && tokenId !== undefined && owns && used === false && minted === false && isOpen && !soldOut && vrf.value !== undefined,
  );

  async function mint() {
    if (!genesis || !canMint || tokenId === undefined || vrf.value === undefined) return;
    const value = vrf.value;
    const ok = await tx.run("Genesis mint", () =>
      writeContractAsync({ address: genesis, abi: towackGenesisAbi, functionName: "mint", args: [tokenId], value, chainId }),
    );
    if (ok) onMinted();
  }

  if (!account) {
    return (
      <div className="rounded-2xl border border-line bg-card px-4 py-4 text-center">
        <p className="font-medium text-sub">Connect the wallet that holds your Agent ID.</p>
        <div className="mt-3 flex justify-center">
          <ConnectPill />
        </div>
        <AgentPathToggle flow="genesis" className="mt-3" />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[13px] font-semibold uppercase tracking-[.15em] text-muted" htmlFor="genesis-token-id">
        Agent ID handle or token id
      </label>
      <input
        id="genesis-token-id"
        placeholder={
          autoHandle
            ? `${autoHandle}.ai (found in your wallet)`
            : autoId !== undefined
              ? `#${autoId.toString()} (found in your wallet)`
              : "e.g. yourname.ai or token id"
        }
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mt-2 h-12 w-full min-w-0 rounded-2xl border border-line bg-card px-4 font-display text-[18px] font-semibold placeholder:font-medium placeholder:text-dim focus:outline-none focus-visible:ring-4 focus-visible:ring-gold/40"
      />
      <ul className="mt-4 space-y-2.5">
        <Check ok={tokenId === undefined ? false : owns}>
          {tokenId === undefined
            ? "Enter your Agent ID handle or token id"
            : owns
              ? `You own Agent ID ${displayId}`
              : owns === false
                ? `This wallet does not own ${displayId}`
                : "Checking owner…"}
        </Check>
        <Check ok={used === undefined ? undefined : !used}>{used ? "That Agent ID already claimed Genesis" : "Agent ID not used yet"}</Check>
        <Check ok={minted === undefined ? undefined : !minted}>{minted ? "This wallet already claimed — see your spin" : "Wallet not used yet"}</Check>
        <Check ok={isOpen === undefined ? undefined : isOpen && !soldOut}>{soldOut ? "All 300 claimed" : isOpen ? "Genesis window open" : "Genesis window closed"}</Check>
      </ul>
      <Button tone="gold" size="lg" className="mt-5 w-full min-h-14" disabled={!canMint || tx.busy} onClick={mint}>
        {tx.busy ? "Check your wallet…" : minted ? "Already claimed" : "Claim free + spin"}
      </Button>
      <p className="mt-2 text-center text-sm font-medium text-muted">
        {vrf.supported === false
          ? "Free: you only pay gas. Your wallet asks you to confirm."
          : `The mint is free: 0 BNB goes to Towack. Your wallet attaches about ${vrf.label} BNB as a Chainlink VRF randomness buffer; most of it (every unused wei) is refunded in the same transaction. You still pay gas.`}
      </p>
      <TxNotice state={tx.state} onClose={tx.reset} />
      {!minted ? <AgentPathToggle flow="genesis" className="mt-4" /> : null}
    </div>
  );
}

/** The 7 Genesis tiers: multiplier, total TWAK and slots out of 300 (live remaining once deployed). */
function GenesisLegend({ remaining }: { remaining?: number[] }) {
  return (
    <>
    <div className="mt-5 text-[12px] font-semibold uppercase tracking-[.15em] text-muted">Total TWAK per slot · slots of 300</div>
    <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 [&>*]:min-w-0" aria-label="Genesis wheel: total TWAK per slot and odds">
      {GENESIS_PRIZES.map((p) => (
        <li key={p.id} className="flex items-center gap-2 rounded-2xl border border-line bg-card px-2.5 py-2">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line font-display text-[11px] font-semibold"
            style={{ background: p.fill, color: p.ink }}
          >
            {p.kind === "none" ? "1×" : p.wheel}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block whitespace-nowrap font-mono text-[14px] font-medium">{(p.total / 1000).toLocaleString("en-US")}K</span>
            <span className="block whitespace-nowrap text-[12px] font-semibold text-muted">
              {remaining ? `${remaining[p.id]} left` : `${p.slots} / 300`}
            </span>
          </span>
        </li>
      ))}
    </ul>
    </>
  );
}

/** Genesis 300 banner on /mint: counter, copy, claim, and the Genesis-only wheel. */
export function GenesisCard() {
  const { account } = useTowack();
  const { genesis, mintCount, cap, retryDelay, remaining } = useGenesisState();
  const { prize } = useMyGenesis();
  const demo = useGenesisDemo();
  const [fresh, setFresh] = useState(false);
  const pct = mintCount !== undefined ? Math.min(100, (Number(mintCount) / Number(cap)) * 100) : 0;

  const wheel = demo.active ? (
    <GenesisDemoWheel />
  ) : genesis && account && prize?.minted ? (
    <MyGenesisWheel fresh={fresh} retryDelay={retryDelay} />
  ) : (
    <GenesisWheelStage status="none" idleNote="Claim to spin. Each Genesis mint pops one slot from a fixed 300-slot TWAK-only deck." />
  );

  return (
    <section id="genesis" className="scroll-mt-24">
      <Panel tone="gold" className="relative">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr] [&>*]:min-w-0">
          {/* copy + counter */}
          <div className="lg:col-start-1">
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>Genesis 300 · free</Kicker>
              <Pill tone="neutral" className="border border-line">TWAK ONLY</Pill>
              <VrfSource consumer={genesis} />
            </div>
            <h2 className="mt-2 font-display text-[30px] font-semibold leading-[1.05] sm:text-[40px]">300 free spins for Agent ID holders</h2>
            <p className="mt-3 font-medium text-sub">
              One free mint per Agent ID and per wallet: <b className="text-fg">{BASE_TEXT}</b> on the spot plus one spin of a TWAK-only wheel (up to 5×,
              i.e. 100,000 TWAK). The mint itself is free: 0 BNB goes to Towack. The tiny BNB your wallet attaches is only a Chainlink VRF randomness buffer, and most of it (every unused wei) is refunded automatically in the same transaction. Funded from the 5% ecosystem allocation (8M TWAK budget) and separate from the paid 5,000.
            </p>

            <div className="mt-5 flex items-end justify-between gap-3">
              <div className="font-display text-[46px] font-semibold leading-none sm:text-[54px]">
                <AnimatedNumber value={mintCount !== undefined ? Number(mintCount) : undefined} />
                <span className="text-[24px] text-muted sm:text-[28px]"> / {Number(cap)}</span>
              </div>
              <Pill tone="neutral" className="shrink-0">CLAIMED</Pill>
            </div>
            <div
              className="mt-3 h-7 overflow-hidden rounded-full border border-line bg-card"
              role="progressbar"
              aria-valuenow={Number(mintCount ?? 0)}
              aria-valuemin={0}
              aria-valuemax={Number(cap)}
              aria-label="Genesis spots claimed"
            >
              <ProgressFill pct={pct} className="rounded-full bg-gold" />
            </div>
            <GenesisLegend remaining={remaining} />
          </div>

          {/* wheel: right column on desktop, between copy and CTA on phones */}
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1" data-genesis-wheel>
            {wheel}
            {demo.allowed && !demo.active ? (
              <p className="mt-1 text-center text-xs font-medium text-muted">
                Preview only:{" "}
                <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=genesis#genesis">
                  play a Genesis demo spin
                </a>
              </p>
            ) : null}
          </div>

          {/* CTA */}
          <div className="lg:col-start-1">
            {genesis ? (
              <GenesisClaim onMinted={() => setFresh(true)} />
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-card px-4 py-5 text-center">
                <div className="font-display text-[20px] font-semibold">Genesis 300 unavailable</div>
                <p className="mt-1 text-sm font-medium text-sub">Not available right now. Nothing to sign or send.</p>
                <AgentPathToggle flow="genesis" className="mt-4" />
              </div>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}
