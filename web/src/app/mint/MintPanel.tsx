"use client";

import { useState } from "react";
import { isAddressEqual, parseEther, zeroAddress } from "viem";
import { useBalance, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, towackLaunchAbi } from "@/abi";
import { AnimatedNumber, ProgressFill } from "@/components/motion";
import { DemoWheel, MyWheel } from "@/components/MyWheel";
import { SpinFeed, WheelStage } from "@/components/PrizeBooth";
import { AgentPathToggle } from "@/components/AgentPath";
import { ChainNote, LegacyLaunchNote, NeedsContracts, NeedsWallet, RpcErrorNotice, TxNotice, VrfSource } from "@/components/status";
import { Button, Check, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { DEMO_SPINS, LAUNCH_PHASES, useDemoWheel, useLaunchState, useRecentSpins } from "@/lib/draw";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { referralLabel, useReferralFromUrl } from "@/lib/referral";
import { useNow } from "@/lib/useNow";
import { useVrfFee } from "@/lib/vrfFee";
const MINT_PRICE_FALLBACK = parseEther("0.1");
const CAP_FALLBACK = 5000n;

export function MintPanel() {
  const { chainId, addresses, account } = useTowack();
  const launch = addresses.launch;
  const now = useNow();

  const { data: launchData, isError: launchErr, refetch: refetchLaunch } = useReadContracts({
    contracts: [
      { address: launch, abi: towackLaunchAbi, functionName: "phase", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "mintCount", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "MAX_MINTS", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "MINT_PRICE", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "mintStart", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "mintEnd", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "token", chainId },
      { address: launch, abi: towackLaunchAbi, functionName: "agentId", chainId },
    ],
    query: { enabled: Boolean(launch), refetchInterval: 15_000 },
  });
  const [phaseR, countR, capR, priceR, startR, endR, tokenR, agentR] = launchData ?? [];
  const phase = phaseR?.result;
  const mintCount = countR?.result;
  const cap = capR?.result ?? CAP_FALLBACK;
  const price = priceR?.result ?? MINT_PRICE_FALLBACK;
  const mintStart = startR?.result;
  const mintEnd = endR?.result;
  const bound = tokenR?.result ? !/^0x0{40}$/i.test(tokenR.result) : undefined;

  // The launch contract's own registry is authoritative; fall back to the configured one before deploy.
  const registry = agentR?.result ?? addresses.agentId;

  const { data: agentBal, isLoading: agentLoading } = useReadContract({
    address: registry,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(registry && account) },
  });
  const { data: minted } = useReadContract({
    address: launch,
    abi: towackLaunchAbi,
    functionName: "hasMinted",
    args: account ? [account] : undefined,
    chainId,
    query: { enabled: Boolean(launch && account) },
  });
  // Referrer from `?ref=<address>&handle=<name.ai>` (or a /r/<handle> landing). The contract reverts on a self
  // referral or a referrer without an Agent ID, so those are shown and the mint credits nobody (address(0)).
  const urlRef = useReferralFromUrl();
  const { data: refAgentBal, isPending: refPending } = useReadContract({
    address: registry,
    abi: agentIdAbi,
    functionName: "balanceOf",
    args: urlRef.address ? [urlRef.address] : undefined,
    chainId,
    query: { enabled: Boolean(registry && urlRef.address) },
  });
  const selfRef = Boolean(urlRef.address && account && isAddressEqual(urlRef.address, account));
  const refNoAgent = refAgentBal !== undefined && refAgentBal === 0n;
  const refChecking = Boolean(urlRef.address && registry && refPending); // a failed lookup unblocks; the contract still checks
  const referrer = urlRef.address && !selfRef && !refNoAgent ? urlRef.address : undefined;
  const refLabel = referralLabel(urlRef);

  const { data: bal } = useBalance({ address: account, chainId, query: { enabled: Boolean(account) } });

  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const { legacy, retryDelay } = useLaunchState();
  const demo = useDemoWheel(legacy);
  const spins = useRecentSpins(!legacy);
  const [fresh, setFresh] = useState(false);
  // Chainlink VRF fee on top of the 0.1 BNB price (exact wrapper price forwarded to the Chainlink VRF wrapper; excess refunded by us).
  const vrf = useVrfFee(launch, chainId);
  const mintValue = vrf.value !== undefined ? price + vrf.value : undefined;

  const hasAgent = agentBal === undefined ? undefined : agentBal > 0n;
  const timeKnown = now > 0 && mintStart !== undefined && mintEnd !== undefined;
  const beforeStart = timeKnown ? BigInt(now) < mintStart : undefined;
  const afterEnd = timeKnown ? BigInt(now) >= mintEnd : undefined;
  const windowOpen = timeKnown ? !beforeStart && !afterEnd : undefined;
  const soldOut = mintCount !== undefined ? mintCount >= cap : undefined;
  const phaseOk = phase === undefined ? undefined : phase === 0;
  const enoughBnb = bal && mintValue !== undefined ? bal.value > mintValue : undefined; // a little headroom for gas

  const canMint =
    Boolean(account) &&
    hasAgent === true &&
    minted === false &&
    phaseOk === true &&
    windowOpen === true &&
    soldOut === false &&
    bound === true &&
    mintValue !== undefined &&
    !refChecking &&
    !legacy;

  const pct = mintCount !== undefined ? Math.min(100, (Number(mintCount) / Number(cap)) * 100) : 0;

  async function mint() {
    if (!launch || !canMint) return;
    if (mintValue === undefined) return;
    // MINT_PRICE (0.1 BNB) + the quoted VRF fee (+ a small cushion the contract refunds). The wallet asks the
    // user to confirm; nothing is auto-signed. Pre-fee contracts (vrf.supported === false) get exactly 0.1 BNB.
    // Always mint(address referrer); address(0) = no referral (same as the zero-arg mint()).
    const ok = await tx.run("Mint", () =>
      writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "mint", args: [referrer ?? zeroAddress], value: mintValue, chainId }),
    );
    if (ok) setFresh(true); // confirmed: the wheel starts its anticipation spin right away
  }

  let windowText = "—";
  if (timeKnown) {
    if (beforeStart) windowText = `Opens in ${fmtDuration(Number(mintStart) - now)}`;
    else if (afterEnd) windowText = "Closed";
    else windowText = `Closes in ${fmtDuration(Number(mintEnd) - now)}`;
  }

  const wheel = demo.active ? (
    <DemoWheel size={440} />
  ) : launch && account && minted && !legacy ? (
    <MyWheel fresh={fresh} retryDelay={retryDelay} size={440} />
  ) : (
    <WheelStage
      status="none"
      size={440}
      idleNote={
        legacy
          ? "The wheel goes live once the per-mint launch contract is deployed on this network."
          : "Mint to spin. Each mint pops one slot from the fixed 5,000-slot deck, drawn by Chainlink VRF."
      }
    />
  );

  return (
    <div className="grid grid-cols-12 gap-x-0 gap-y-8 lg:gap-x-8 [&>*]:min-w-0">
      <div className="col-span-12 space-y-8 lg:col-span-7">
        <Panel className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[28px] font-semibold">The prize wheel</h2>
            <ChainNote />
          </div>
          {legacy ? <LegacyLaunchNote /> : null}
          <div className="mt-3">
            <VrfSource consumer={launch} />
          </div>
          <div className="mt-6">{wheel}</div>
          {demo.allowed && !demo.active ? (
            <p className="mt-2 text-center text-xs font-medium text-muted">
              Preview only:{" "}
              <a className="inline-flex min-h-10 items-center px-1 underline" href="?demo=wheel">
                play a demo spin
              </a> (no transaction, not a real prize).
            </p>
          ) : null}
        </Panel>

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[28px] font-semibold">Slot counter</h2>
          </div>
          <div className="mt-6">
          {launchErr ? <RpcErrorNotice onRetry={() => void refetchLaunch()} label="Could not load mint contract state." /> : null}
          <NeedsContracts keys={["launch"]}>
            <div>
              <div className="flex items-end justify-between">
                <div className="font-display text-[54px] font-semibold leading-none">
                  <AnimatedNumber value={mintCount !== undefined ? Number(mintCount) : undefined} />
                  <span className="text-[28px] text-muted"> / {Number(cap).toLocaleString("en-US")}</span>
                </div>
                <Pill tone={phase === 0 ? "neutral" : "gold"}>{phase !== undefined ? (LAUNCH_PHASES[phase] ?? "—").toUpperCase() : "LOADING"}</Pill>
              </div>
              <div
                className="mt-4 h-8 overflow-hidden rounded-full border border-line bg-card-2"
                role="progressbar"
                aria-valuenow={Number(mintCount ?? 0)}
                aria-valuemin={0}
                aria-valuemax={Number(cap)}
                aria-label="Slots minted"
              >
                <ProgressFill pct={pct} className="rounded-full bg-gold" />
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Price"
                  value={`${fmt18(price)} BNB`}
                  sub={vrf.supported === false ? "exactly, no extra" : `+ VRF fee ~${vrf.label}`}
                />
                <Stat label="Window" value={windowText} sub={mintEnd ? `ends ${fmtDate(mintEnd)}` : undefined} />
                <Stat label="You get" value="80,000 TWAK" sub="instantly, plus one spin" />
              </div>
              {bound === false ? (
                <p className="mt-4 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
                  Mint is not open yet. Please check back soon.
                </p>
              ) : null}
            </div>
          </NeedsContracts>
          </div>
        </Panel>

        <Panel tone="raised" shadow={false}>
          <h2 className="font-display text-[24px] font-semibold">How the mint works</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 font-medium text-sub">
            <li>Hold an Agent ID in the wallet you connect (Agent IDs are issued in the Binance App).</li>
            <li>Send 0.1 BNB plus a small Chainlink VRF fee (about {vrf.label}) for your random draw. You confirm it in your own wallet.</li>
            <li>80,000 TWAK arrives in the same transaction, and your spin starts.</li>
            <li>
              When Chainlink VRF answers, one slot is drawn from the remaining 5,000-slot deck and the wheel stops on it. Exactly one outcome:
              a BNB refund tier, a TWAK bonus tier, or better luck next time.
            </li>
            <li>Claim your prize whenever you like (within 180 days of listing). Prizes are pulled, never pushed.</li>
            <li>
              Came from a friend&apos;s link? Their wallet earns 0.005 BNB (5% of the price) from the contract. Your price is the same 0.1 BNB.{" "}
              <a className="underline" href="/referrals">
                Get your own link
              </a>
              .
            </li>
          </ol>
          <p className="mt-4 font-semibold text-sub">
            You can lose some or all of the 0.1 BNB (the VRF fee is never refunded by prizes). Most slots get back less than they paid. This is a game of chance, not an investment.
          </p>
        </Panel>
      </div>

      <div className="col-span-12 space-y-8 lg:col-span-5">
        <Panel>
          <h2 className="font-display text-[28px] font-semibold">Your ticket</h2>
          <div className="mt-5">
            <NeedsWallet why="Connect to check your Agent ID and mint." agent="launch" referral={urlRef}>
              <ul className="space-y-3">
                <Check ok={registry ? (agentLoading ? undefined : hasAgent) : false}>
                  {!registry
                    ? "Agent ID registry not configured on this network yet"
                    : hasAgent === undefined
                      ? "Checking Agent ID…"
                      : hasAgent
                        ? "Agent ID found in this wallet"
                        : "No Agent ID in this wallet"}
                </Check>
                <Check ok={launch ? (minted === undefined ? undefined : !minted) : undefined}>
                  {minted ? "Already minted with this wallet — see your spin" : "Not minted yet"}
                </Check>
                <Check ok={launch ? (phaseOk && windowOpen) : undefined}>
                  {phase !== undefined && phase !== 0 ? "Mint is closed" : windowOpen === false ? `Mint window: ${windowText}` : "Mint window open"}
                </Check>
                <Check ok={launch ? (soldOut === undefined ? undefined : !soldOut) : undefined}>{soldOut ? "Sold out" : "Slots left"}</Check>
                <Check ok={enoughBnb}>{bal ? `Balance ${fmt18(bal.value)} BNB (need 0.1 + VRF fee + gas)` : "Checking balance…"}</Check>
              </ul>

              {hasAgent === false ? (
                <p className="mt-5 rounded-2xl border border-line bg-down/10 px-4 py-3 font-medium">
                  Minting needs an Agent ID. Get one in the official Binance App (mainnet), then come back with that wallet.
                </p>
              ) : null}

              <ReferrerNote label={refLabel} selfRef={selfRef} noAgent={refNoAgent} checking={refChecking} />

              {launch ? (
                <>
                  <Button tone="gold" size="lg" className="mt-6 w-full" disabled={!canMint || tx.busy} onClick={mint}>
                    {tx.busy ? "Check your wallet…" : minted ? "Already minted" : legacy ? "Mint paused for redeploy" : vrf.supported === false ? "Mint for 0.1 BNB" : `Mint for 0.1 BNB + ${vrf.label} VRF fee`}
                  </Button>
                  <p className="mt-3 text-center text-sm font-medium text-muted">Your wallet will ask you to confirm. We never sign for you.</p>
                  <TxNotice state={tx.state} onClose={tx.reset} />
                  <AgentPathToggle flow="launch" referral={{ address: referrer, handle: referrer ? urlRef.handle : undefined }} className="mt-4" />
                </>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-line bg-gold/5 px-4 py-5 text-center">
                  <div className="font-display text-[20px] font-semibold">Mint unavailable</div>
                  <p className="mt-1 text-sm font-medium text-sub">Minting is not available right now. Nothing to sign or send.</p>
                  <AgentPathToggle flow="launch" referral={{ address: referrer, handle: referrer ? urlRef.handle : undefined }} className="mt-4" />
                </div>
              )}
            </NeedsWallet>
          </div>
        </Panel>

        <Panel tone="raised">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[24px] font-semibold text-gold">Recent spins</h2>
            <span className="flex items-center gap-2 text-xs font-semibold text-sub">
              <span className=" h-2.5 w-2.5 rounded-full bg-gold/10" /> LIVE
            </span>
          </div>
          <div className="mt-4 text-fg">
            <SpinFeed spins={demo.active ? DEMO_SPINS : spins} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Who this mint credits (from the referral link), or why it credits nobody. */
function ReferrerNote({ label, selfRef, noAgent, checking }: { label?: string; selfRef: boolean; noAgent: boolean; checking: boolean }) {
  if (!label) {
    return <p className="mt-5 text-sm font-medium text-muted">No referrer: this mint credits nobody (referrer = address(0)).</p>;
  }
  if (selfRef || noAgent) {
    return (
      <p className="mt-5 rounded-2xl border border-line bg-down/10 px-4 py-3 font-medium">
        <Pill tone="gold">REFERRAL NOT APPLIED</Pill>{" "}
        {selfRef ? "That referral link is your own wallet, and you can't refer yourself." : `${label} holds no Agent ID, so it can't earn referrals.`} This
        mint credits nobody (address(0)).
      </p>
    );
  }
  return (
    <p className="mt-5 rounded-2xl border border-line bg-gold/5 px-4 py-3 font-medium">
      <Pill tone="neutral">REFERRED BY</Pill> <span className="break-all">{label}</span>
      {checking ? " (checking Agent ID…)" : ". They earn 0.005 BNB from this mint; your price stays 0.1 BNB."}
    </p>
  );
}
