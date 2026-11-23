"use client";

import { useEffect, useState } from "react";
import { useWriteContract } from "wagmi";
import { towackLaunchAbi } from "@/abi";
import { useTowack } from "@/lib/chain";
import { useMyPrize } from "@/lib/draw";
import { fmtDuration } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { useVrfFee } from "@/lib/vrfFee";
import { ShareButton, WheelStage, type WheelStatus } from "./PrizeBooth";
import { AgentPathToggle } from "./AgentPath";
import { TxNotice } from "./status";
import { Button, Pill } from "./ui";

const DEMO_PRIZES = [5, 0, 7, 10, 2];

/** Plays a fake spin: ~2.8s anticipation, then lands on a sample prize. Labelled as demo everywhere. */
export function DemoWheel({ size }: { size?: number }) {
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState<WheelStatus>("waiting");
  useEffect(() => {
    const t = setTimeout(() => setStatus("assigned"), 2800);
    return () => clearTimeout(t);
  }, [round]);
  const prizeId = DEMO_PRIZES[(round - 1) % DEMO_PRIZES.length];
  return (
    <WheelStage
      key={round}
      status={status}
      prizeId={prizeId}
      salt={round}
      fresh
      demo
      size={size}
      waitingNote="Demo only — no transaction, no VRF."
      actions={
        <Button
          tone="line"
          size="sm"
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

/**
 * The connected wallet's wheel. Spins while the VRF request is pending, lands on the on-chain prize, and
 * offers claim + share. `fresh` = the wallet just minted in this session (always show the spin).
 */
export function MyWheel({ fresh = false, retryDelay, idleNote, size }: { fresh?: boolean; retryDelay: number; idleNote?: string; size?: number }) {
  const { chainId, addresses, account } = useTowack();
  const { prize, mintIndex, requestedAt } = useMyPrize();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const now = useNow(5_000);

  const status: WheelStatus = !prize?.minted ? "none" : prize.assigned ? "assigned" : "waiting";
  const launch = addresses.launch;
  const canRetry = status === "waiting" && now > 0 && requestedAt !== undefined && requestedAt > 0 && now >= requestedAt + retryDelay;
  const winsSomething = Boolean(prize && (prize.bnb > 0n || prize.bonus > 0n));
  const vrf = useVrfFee(launch, chainId); // a retry is a new VRF request: the caller pays its fee

  const claim = () =>
    launch && tx.run("Claim prize", () => writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "claim", chainId }));
  const retry = () =>
    launch &&
    account &&
    vrf.value !== undefined &&
    tx.run("Retry VRF", () =>
      writeContractAsync({ address: launch, abi: towackLaunchAbi, functionName: "retryPrize", args: [account], value: vrf.value, chainId }),
    );

  const waitingNote = (
    <>
      {mintIndex ? <Pill tone="neutral">MINT #{mintIndex}</Pill> : null}{" "}
      {requestedAt && now ? `Requested ${fmtDuration(now - requestedAt)} ago. ` : ""}
      The prize is drawn on-chain from the remaining deck when Chainlink VRF answers.
      {canRetry ? (
        <div className="mt-3 flex justify-center">
          <Button tone="line" size="sm" disabled={tx.busy || vrf.value === undefined} onClick={retry}>
            {vrf.supported === false ? "Retry VRF request" : `Retry VRF request (+${vrf.label} VRF fee)`}
          </Button>
        </div>
      ) : null}
    </>
  );

  const actions =
    prize && status === "assigned" ? (
      <>
        {winsSomething && !prize.claimed ? (
          <Button tone="gold" size="sm" disabled={tx.busy} onClick={claim}>
            {tx.busy ? "Check your wallet…" : "Claim prize"}
          </Button>
        ) : null}
        {winsSomething && prize.claimed ? <Pill tone="gold" className="border border-line px-4 py-2 text-sm">CLAIMED ✓</Pill> : null}
        <ShareButton prizeId={prize.prizeId} />
      </>
    ) : undefined;

  return (
    <div>
      <WheelStage
        status={status}
        prizeId={prize?.assigned ? prize.prizeId : undefined}
        salt={mintIndex ?? 0}
        fresh={fresh}
        waitingNote={waitingNote}
        actions={actions}
        idleNote={idleNote}
        size={size}
      />
      <TxNotice state={tx.state} onClose={tx.reset} />
      {status === "assigned" && winsSomething && !prize?.claimed ? <AgentPathToggle flow="launchClaim" className="mt-4" /> : null}
    </div>
  );
}
