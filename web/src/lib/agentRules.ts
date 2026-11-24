/**
 * Rule lines shared by every Binance Agentic Wallet (BAW) instruction Towack shows ("Give this to your AI agent").
 * They follow Binance's official `binance-agentic-wallet` skill, `references/external-sign.md`:
 * Developer Mode gating (7-day expiry, balance cap 351804) and the two execute outcomes
 * (BROADCASTED with a txHash, or PENDING_CONFIRMATION awaiting approval in the Binance App).
 */

export const DEV_MODE_RULE = `- Before any contract-call, run \`baw wallet settings --json\` and confirm devMode.enabled=true (and devMode.expiresAt is in the future). If it is off or expired, tell me to turn it on in the Binance App (Agentic Wallet > Settings > Developer Mode) and WAIT. It stays on for 7 days; if enabling is refused (351804), my wallet balance is over the Developer Mode cap.`;

export const EXECUTE_RESULT_RULE = `- After execute: status BROADCASTED gives a txHash; check it on BscScan before saying it worked. Status PENDING_CONFIRMATION means I must approve it in the Binance App first: tell me, wait, then check the result. It is NOT a failure, and never re-send it. The App may label it "High-risk transaction" (Developer Mode call / token with no price yet): tell me to check the amount and contract there before approving. If preview or execute returns an error, show it to me exactly as returned.`;

/**
 * BAW's preview reports any contract revert as `351805 "Transaction simulation failed: execution reverted"` with no
 * reason for custom errors (a text `Error(string)` reason is appended). Found in live mainnet tests (Genesis
 * `AlreadyMinted`, TWAK `ERC20InsufficientAllowance`): the agent must look the reason up itself.
 */
export const REVERT_REASON_RULE = `- If preview fails with 351805 "execution reverted" and no text reason after it, find out WHY before telling me: run an eth_call with the SAME to, data and value, from = my wallet (e.g. \`cast call <to> <data> --value <wei> --from <my wallet> --rpc-url https://bsc-dataseed.bnbchain.org\`), and match the first 4 bytes of the revert data against the "Revert reasons" table in the Towack skill (0x08c379a0 is a plain text error). Tell me the reason in plain words. Do not retry or change the transaction to get around it.`;
