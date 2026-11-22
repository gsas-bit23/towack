"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

const FRIENDLY: Record<string, string> = {
  NoAgentId: "This wallet does not hold an Agent ID.",
  AlreadyMinted: "This wallet has already minted.",
  WrongPrice: "Mint price is 0.1 BNB (plus the Chainlink VRF fee).",
  VrfFeeTooLow: "Not enough BNB for the Chainlink VRF fee. Refresh the quote and try again (any extra is refunded).",
  RefundFailed: "The contract could not refund the extra BNB to this wallet.",
  SoldOut: "All 5,000 slots are minted.",
  MintNotOpen: "The mint window is not open right now.",
  WrongPhase: "The launch is not in the right phase for that.",
  NotAssigned: "Your prize has not been drawn yet — the wheel is still waiting for Chainlink VRF.",
  AlreadyAssigned: "Your prize is already assigned.",
  PrizesPending: "Some mints are still waiting for their VRF prize. Listing unlocks once every spin has landed.",
  MintStillOpen: "The mint is still open.",
  TooEarly: "Too early — try again later.",
  NotMinter: "This wallet did not mint.",
  AlreadyClaimed: "Already claimed.",
  SelfReferral: "You can't use your own wallet as the referrer.",
  ReferrerHasNoAgentId: "That referrer wallet does not hold an Agent ID, so it can't earn referrals.",
  NothingToClaimReferral: "No referral BNB to claim yet.",
  NothingToClaim: "Better luck next time — no prize on this spin. The base TWAK from your mint is already in your wallet.",
  NotAgentOwner: "This wallet does not own that Agent ID token.",
  TokenIdUsed: "That Agent ID has already been used for a Genesis mint.",
  NotOpen: "The Genesis 300 window is not open right now.",
  Underfunded: "The Genesis budget is not fully funded yet.",
  ClaimWindowClosed: "The 180-day claim window has closed.",
  DailyLimitExceeded: "This trade would go over your daily limit.",
  InsufficientOutput: "Price moved beyond your slippage setting.",
  ZeroAmount: "Enter an amount above zero.",
  BadLimit: "Limit must be above zero (use a tiny value to freeze).",
  EpochNotFinished: "That epoch has not finished yet.",
  EntriesPaused: "New pool-wheel entries are paused. Pending spins still land and claims still work.",
  EntryTooSmall: "The minimum entry is 100 TWAK.",
  EntryTooLarge: "That entry is above the current max (0.5% of the free pool). Try a smaller amount.",
  PoolTooSmall: "The pool can't cover a 10× win on that entry right now. Try a smaller amount.",
  NotPending: "That spin has already landed.",
  BnbTransferFailed: "The BNB part of your prize could not be sent to this wallet.",
  NotBound: "Contracts are still being wired up.",
  PairLocked: "Trading opens after the listing is finalized.",
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
