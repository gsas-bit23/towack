"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { useReadContract, useWriteContract } from "wagmi";
import { towackGenesisAbi } from "@/abi";
import { useTowack } from "@/lib/chain";
import { agentNftAbi, useGenesisState, useMyGenesis } from "@/lib/genesis";
import { GENESIS_BASE, GENESIS_BUDGET, GENESIS_COST_TEXT, genesisShareText } from "@/lib/genesisPrizes";
import { useTx } from "@/lib/tx";
import { AnimatedNumber, Confetti, ProgressFill, SuccessCheck } from "./motion";
import { ShareButton } from "./PrizeBooth";
import { ConnectPill } from "./ConnectPill";
import { AgentPathToggle } from "./AgentPath";
import { TxNotice } from "./status";
import { Button, Check, Kicker, Panel, Pill } from "./ui";

const BASE_TEXT = `${GENESIS_BASE.toLocaleString("en-US")} TWAK`;

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

/** Claimed state: 20,000 TWAK already in the wallet (sent in the mint tx itself). */
function GenesisClaimed({ mintIndex, burst }: { mintIndex?: number; burst: number }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 overflow-hidden rounded-2xl" aria-hidden="true">
        <Confetti fire={burst} />
      </div>
      <motion.div
        initial={{ y: 12, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="gold-hairline rounded-2xl border border-gold/40 bg-gold/[.06] px-5 py-6 text-center"
        aria-live="polite"
      >
        <SuccessCheck className="mx-auto mb-2 h-9 w-9" />
        <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">Genesis claimed{mintIndex ? ` · #${mintIndex}` : ""}</div>
        <div className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-gold">{BASE_TEXT}</div>
        <div className="mt-1 text-sm font-medium text-muted">Already in your wallet. Nothing else to claim.</div>
        <div className="mt-4 flex justify-center">
          <ShareButton prizeId={0} path="/mint" text={genesisShareText(mintIndex)} />
        </div>
      </motion.div>
    </div>
  );
}

/** Mint CTA: finds (or takes) the Agent ID handle / token id, checks it, and calls mint(tokenId) with 0 BNB. */
function GenesisClaim({ onMinted }: { onMinted: () => void }) {
  const { chainId, addresses, account } = useTowack();
  const { genesis, isOpen, mintCount, cap, registry } = useGenesisState();
  const { minted } = useMyGenesis();
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
  const soldOut = mintCount !== undefined ? mintCount >= cap : undefined;
  const canMint = Boolean(genesis && account && tokenId !== undefined && owns && used === false && minted === false && isOpen && !soldOut);

  async function mint() {
    if (!genesis || !canMint || tokenId === undefined) return;
    // Non-payable: no `value` (0 BNB). The wallet only pays ordinary network gas.
    const ok = await tx.run("Genesis claim", () =>
      writeContractAsync({ address: genesis, abi: towackGenesisAbi, functionName: "mint", args: [tokenId], chainId }),
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
        <Check ok={minted === undefined ? undefined : !minted}>{minted ? "This wallet already claimed its 20,000 TWAK" : "Wallet not used yet"}</Check>
        <Check ok={isOpen === undefined ? undefined : isOpen && !soldOut}>{soldOut ? "All 300 claimed" : isOpen ? "Genesis window open" : "Genesis window closed"}</Check>
      </ul>
      <Button tone="gold" size="lg" className="mt-5 w-full min-h-14" disabled={!canMint || tx.busy} onClick={mint}>
        {tx.busy ? "Check your wallet…" : minted ? "Already claimed" : `Claim ${BASE_TEXT} free`}
      </Button>
      <p className="mt-2 text-center text-sm font-medium text-muted">
        {GENESIS_COST_TEXT}. 0 BNB is attached; you only confirm the network gas in your wallet.
      </p>
      <TxNotice state={tx.state} onClose={tx.reset} />
      {!minted ? <AgentPathToggle flow="genesis" className="mt-4" /> : null}
    </div>
  );
}

/** Right-hand summary: what a claim gives, before the wallet has claimed. */
function GenesisOffer() {
  return (
    <div className="rounded-2xl border border-line-2 bg-card-2 px-5 py-6 text-center">
      <div className="text-[12px] font-semibold uppercase tracking-[.12em] text-muted">Every Genesis claim</div>
      <div className="mt-1 font-display text-[44px] font-semibold leading-none text-gold sm:text-[52px]">{BASE_TEXT}</div>
      <div className="mt-2 text-sm font-medium text-sub">Sent to your wallet in the same transaction</div>
      <ul className="mx-auto mt-5 max-w-sm space-y-2.5 text-left">
        <Check ok>0 BNB attached: no mint price, no fee, no deposit</Check>
        <Check ok>Only ordinary network gas (~$0.002)</Check>
        <Check ok>One transaction: no spin, no waiting, no second claim</Check>
        <Check ok>One claim per Agent ID and per wallet</Check>
      </ul>
    </div>
  );
}

/** Genesis 300 banner on /mint: counter, copy, claim CTA and claimed state. */
export function GenesisCard() {
  const { account } = useTowack();
  const { genesis, mintCount, cap, refetch } = useGenesisState();
  const my = useMyGenesis();
  const [burst, setBurst] = useState(0);
  const pct = mintCount !== undefined ? Math.min(100, (Number(mintCount) / Number(cap)) * 100) : 0;
  const claimed = Boolean(genesis && account && my.minted);

  return (
    <section id="genesis" className="scroll-mt-24">
      <Panel tone="gold" className="relative">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr] [&>*]:min-w-0">
          {/* copy + counter */}
          <div className="lg:col-start-1">
            <div className="flex flex-wrap items-center gap-2">
              <Kicker>Genesis 300 · free</Kicker>
              <Pill tone="neutral" className="border border-line">GAS ONLY</Pill>
            </div>
            <h2 className="mt-2 font-display text-[30px] font-semibold leading-[1.05] sm:text-[40px]">300 free 20,000 TWAK claims for Agent ID holders</h2>
            <p className="mt-3 font-medium text-sub">
              <b className="text-fg">{GENESIS_COST_TEXT}.</b> One claim per Agent ID and per wallet: you attach 0 BNB, pay only ordinary network gas, and{" "}
              <b className="text-fg">{BASE_TEXT}</b> lands in your wallet in the same transaction. Funded from the 5% ecosystem allocation ({GENESIS_BUDGET} budget) and separate from the paid 5,000.
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
          </div>

          {/* offer / claimed state: right column on desktop */}
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1" data-genesis-offer>
            {claimed ? <GenesisClaimed mintIndex={my.mintIndex} burst={burst} /> : <GenesisOffer />}
          </div>

          {/* CTA */}
          <div className="lg:col-start-1">
            {genesis ? (
              claimed ? null : (
                <GenesisClaim
                  onMinted={() => {
                    setBurst((b) => b + 1);
                    my.refetch();
                    void refetch();
                  }}
                />
              )
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
