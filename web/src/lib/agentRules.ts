/**
 * Rule lines shared by every Binance Agentic Wallet (BAW) instruction Towack shows ("Give this to your AI agent").
 * They follow Binance's official `binance-agentic-wallet` skill, `references/external-sign.md`:
 * Developer Mode gating (7-day expiry, balance cap 351804) and the two execute outcomes
 * (BROADCASTED with a txHash, or PENDING_CONFIRMATION awaiting approval in the Binance App).
 */

export const DEV_MODE_RULE = `- Before any contract-call, run \`baw wallet settings --json\` and confirm devMode.enabled=true (and devMode.expiresAt is in the future). If it is off or expired, tell me to turn it on in the Binance App (Agentic Wallet > Settings > Developer Mode) and WAIT. It stays on for 7 days; if enabling is refused (351804), my wallet balance is over the Developer Mode cap.`;

export const EXECUTE_RESULT_RULE = `- After execute: status BROADCASTED gives a txHash; check it on BscScan before saying it worked. Status PENDING_CONFIRMATION means I must approve it in the Binance App first: tell me, wait, then check the result. It is NOT a failure, and never re-send it. If preview or execute returns an error, show it to me exactly as returned.`;
