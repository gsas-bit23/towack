"use client";

import { parseEther } from "viem";
import { useBalance, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { agentIdAbi, towackLaunchAbi } from "@/abi";
import { ChainNote, NeedsContracts, NeedsWallet, TxNotice } from "@/components/status";
import { Button, Check, Panel, Pill, Stat } from "@/components/ui";
import { useTowack } from "@/lib/chain";
import { fmt18, fmtDate, fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";

export const PHASES = ["Minting", "Draw pending", "Seeded", "Finalized"] as const;
const MINT_PRICE_FALLBACK = parseEther("0.1");
const CAP_FALLBACK = 5000n;

export function MintPanel() {
  const { chainId, addresses, account } = useTowack();
  const launch = addresses.launch;
  const now = useNow();

  const { data: launchData } = useReadContracts({
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
  const { data: bal } = useBalance({ address: account, chainId, query: { enabled: Boolean(account) } });

  const { writeContractAsync } = useWriteContract();
  const tx = useTx();

  const hasAgent = agentBal === undefined ? undefined : agentBal > 0n;
  const timeKnown = now > 0 && mintStart !== undefined && mintEnd !== undefined;
  const beforeStart = timeKnown ? BigInt(now) < mintStart : undefined;
  const afterEnd = timeKnown ? BigInt(now) >= mintEnd : undefined;
  const windowOpen = timeKnown ? !beforeStart && !afterEnd : undefined;
  const soldOut = mintCount !== undefined ? mintCount >= cap : undefined;
  const phaseOk = phase === undefined ? undefined : phase === 0;
  const enoughBnb = bal ? bal.value > price : undefined; // a little headroom for gas

  const canMint =
    Boolean(account) && hasAgent === true && minted === false && phaseOk === true && windowOpen === true && soldOut === false && bound === true;

  const pct = mintCount !== undefined ? Math.min(100, (Number(mintCount) / Number(cap)) * 100) : 0;

  async function mint() {
    if (!launch || !canMint) return;
    await tx.run("Mint", () =>
      writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "mint", value: price, chainId }),
    );
  }

  let windowText = "—";
  if (timeKnown) {
    if (beforeStart) windowText = `Opens in ${fmtDuration(Number(mintStart) - now)}`;
    else if (afterEnd) windowText = "Closed";
    else windowText = `Closes in ${fmtDuration(Number(mintEnd) - now)}`;
  }

  return (
    <div className="grid grid-cols-12 gap-8">
      <div className="col-span-12 space-y-8 lg:col-span-7">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[28px] font-extrabold">Slot counter</h2>
            <ChainNote />
          </div>
          <div className="mt-6">
          <NeedsContracts keys={["launch"]}>
            <div>
              <div className="flex items-end justify-between">
                <div className="font-display text-[54px] font-extrabold leading-none">
                  {mintCount !== undefined ? Number(mintCount).toLocaleString("en-US") : "—"}
                  <span className="text-[28px] text-navy/50"> / {Number(cap).toLocaleString("en-US")}</span>
                </div>
                <Pill tone={phase === 0 ? "sky" : "sun"}>{phase !== undefined ? PHASES[phase].toUpperCase() : "LOADING"}</Pill>
              </div>
              <div
                className="mt-4 h-8 overflow-hidden rounded-full border-4 border-navy bg-ice"
                role="progressbar"
                aria-valuenow={Number(mintCount ?? 0)}
                aria-valuemin={0}
                aria-valuemax={Number(cap)}
                aria-label="Slots minted"
              >
                <div className="h-full bg-candy transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Stat label="Price" value={`${fmt18(price)} BNB`} sub="exactly, no extra" />
                <Stat label="Window" value={windowText} sub={mintEnd ? `ends ${fmtDate(mintEnd)}` : undefined} />
                <Stat label="You get" value="80,000 TWAK" sub="instantly on mint" />
              </div>
              {bound === false ? (
                <p className="mt-4 rounded-2xl border-[3px] border-navy bg-sun-pale px-4 py-3 font-bold">
                  The launch contract is deployed but not wired to the token yet. Mint opens once setup finishes.
                </p>
              ) : null}
            </div>
          </NeedsContracts>
          </div>
        </Panel>

        <Panel tone="skyPale" shadow={false}>
          <h2 className="font-display text-[24px] font-extrabold">How the mint works</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 font-bold text-navy/80">
            <li>Hold an Agent ID in the wallet you connect (Agent IDs are issued in the Binance App on mainnet).</li>
            <li>Send exactly 0.1 BNB with <code className="rounded bg-white px-1">mint()</code>. You confirm it in your own wallet.</li>
            <li>80,000 TWAK arrives in the same transaction.</li>
            <li>When the window ends or all 5,000 are minted, anyone can close the mint. Unsold TWAK is burned.</li>
            <li>One Chainlink VRF seed assigns every slot&apos;s prize. Then you pull your claim on the Draw page.</li>
          </ol>
          <p className="mt-4 font-semibold text-navy/70">
            You can lose some or all of the 0.1 BNB. Most slots get back less than they paid. This is a game, not an investment.
          </p>
        </Panel>
      </div>

      <div className="col-span-12 lg:col-span-5">
        <Panel className="lg:sticky lg:top-[100px]">
          <h2 className="font-display text-[28px] font-extrabold">Your ticket</h2>
          <div className="mt-5">
            <NeedsWallet why="Connect to check your Agent ID and mint.">
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
                  {minted ? "Already minted with this wallet" : "Not minted yet"}
                </Check>
                <Check ok={launch ? (phaseOk && windowOpen) : undefined}>
                  {phase !== undefined && phase !== 0 ? "Mint is closed — the draw has started" : windowOpen === false ? `Mint window: ${windowText}` : "Mint window open"}
                </Check>
                <Check ok={launch ? (soldOut === undefined ? undefined : !soldOut) : undefined}>{soldOut ? "Sold out" : "Slots left"}</Check>
                <Check ok={enoughBnb}>{bal ? `Balance ${fmt18(bal.value)} BNB (need 0.1 + gas)` : "Checking balance…"}</Check>
              </ul>

              {hasAgent === false ? (
                <p className="mt-5 rounded-2xl border-[3px] border-navy bg-candy-pale px-4 py-3 font-bold">
                  Minting needs an Agent ID. Get one in the official Binance App (mainnet), then come back with that wallet.
                </p>
              ) : null}

              {launch ? (
                <>
                  <Button tone="candy" size="lg" className="mt-6 w-full" disabled={!canMint || tx.busy} onClick={mint}>
                    {tx.busy ? "Check your wallet…" : minted ? "Already minted" : "Mint for 0.1 BNB"}
                  </Button>
                  <p className="mt-3 text-center text-sm font-bold text-navy/60">Your wallet will ask you to confirm. We never sign for you.</p>
                  <TxNotice state={tx.state} onClose={tx.reset} />
                </>
              ) : (
                <div className="mt-6 rounded-2xl border-4 border-dashed border-navy bg-sun-pale px-4 py-4 text-center font-display text-[20px] font-extrabold">
                  Contracts deploying soon
                </div>
              )}
            </NeedsWallet>
          </div>
        </Panel>
      </div>
    </div>
  );
}
