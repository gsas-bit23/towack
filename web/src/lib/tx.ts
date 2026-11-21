"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

const FRIENDLY: Record<string, string> = {
  NoAgentId: "This wallet does not hold an Agent ID.",
  AlreadyMinted: "This wallet has already minted.",
  WrongPrice: "Mint price must be exactly 0.1 BNB.",
  SoldOut: "All 5,000 slots are minted.",
  MintNotOpen: "The mint window is not open right now.",
  WrongPhase: "The draw machine is not in the right phase for that.",
  MintStillOpen: "The mint is still open.",
  TooEarly: "Too early — try again later.",
  NotMinter: "This wallet did not mint.",
  AlreadyClaimed: "Already claimed.",
  NothingToClaim: "No prize on this slot — your 80,000 TWAK from the mint is already in your wallet.",
  ClaimWindowClosed: "The 180-day claim window has closed.",
  DailyLimitExceeded: "This trade would go over your daily limit.",
  InsufficientOutput: "Price moved beyond your slippage setting.",
  ZeroAmount: "Enter an amount above zero.",
  BadLimit: "Limit must be above zero (use a tiny value to freeze).",
  EpochNotFinished: "That epoch has not finished yet.",
  NoPrice: "Ticket price is not set yet.",
  ZeroTickets: "That amount buys zero tickets. Burn a bit more TWAK.",
  RoundNotOver: "This round is still running.",
  NoTickets: "No tickets in that round.",
  AlreadyRequested: "The draw was already requested.",
  NotSeeded: "Randomness has not arrived yet.",
  AlreadySettled: "Already settled.",
  NotWinner: "This wallet did not win that round.",
  NotBound: "Contracts are still being wired up.",
  PairLocked: "Trading opens after the draw is finalized.",
};

export function explainError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled in your wallet. Nothing was sent.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && FRIENDLY[name]) return FRIENDLY[name];
      if (revert.reason) return revert.reason;
    }
    return err.shortMessage || err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export type TxState =
  | { status: "idle" }
  | { status: "wallet"; label: string }
  | { status: "pending"; label: string; hash: Hash }
  | { status: "success"; label: string; hash: Hash }
  | { status: "error"; label: string; message: string; hash?: Hash };

/**
 * Runs one user-signed transaction: `send` must call a wagmi write (which opens the user's wallet
 * for confirmation) and return the hash. Nothing here signs anything by itself.
 */
export function useTx() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (label: string, send: () => Promise<Hash>): Promise<boolean> => {
      setState({ status: "wallet", label });
      let hash: Hash | undefined;
      try {
        hash = await send();
        setState({ status: "pending", label, hash });
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted on-chain.");
        setState({ status: "success", label, hash });
        await queryClient.invalidateQueries();
        return true;
      } catch (e) {
        setState({ status: "error", label, message: explainError(e), hash });
        return false;
      }
    },
    [config, queryClient],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy = state.status === "wallet" || state.status === "pending";
  return { state, run, reset, busy };
}
