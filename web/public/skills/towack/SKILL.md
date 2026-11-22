---
name: towack
description: Mint Towack (TWAK) slots (optionally with a referrer), claim Genesis 300, enter the Draw V2 pool wheel, claim prizes and referral BNB, buy/sell TWAK through the Towack router, and swap or bridge tokens via PancakeSwap, Uniswap, and Relay on BNB Smart Chain mainnet using the official Binance Agentic Wallet (BAW) external-sign flow. Use when a user asks to mint, refer, spin, enter, claim, buy, sell, swap or bridge on Towack with their Binance Agentic Wallet.
---

# Towack with Binance Agentic Wallet

Requires Binance's official skill: https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet
(flow reference: `references/external-sign.md` in that skill).

## Hard rules

- **Mainnet only.** BAW supports BNB Smart Chain mainnet only: always `--binanceChainId 56`. BAW does **not** support BSC testnet and cannot connect to the Towack website. Testnet testers must use MetaMask or another browser wallet on the website instead.
- **The website never signs or broadcasts.** Towack's site only displays/copies instructions ("Give this to your AI agent" boxes). No keys, no server-side signing, no BAW CLI from the browser. All signing happens in the user's own BAW after their explicit confirmation.
- **Developer Mode first.** As soon as a request needs `contract-call`, run `baw wallet settings --json` and check `devMode.enabled=true`. If it is off, tell the user to enable Developer Mode in the Binance App and wait.
- **Preview, then wait, then execute.** For every tx:
  1. `baw contract-call preview --binanceChainId 56 --from <wallet> --to <contract> --value <wei> --inputData <hex> --json`
  2. Show the user the parsed tx, the risks and `authorityChanges`. Wait for an explicit "yes".
  3. Only then `baw contract-call execute --requestId <requestId> --json`. Never execute without a fresh preview and the user's "yes"; a two-step flow (approve, then sell/enter) needs a preview + "yes" for **each** step.
- `--value` is raw wei (integer). Never pass a gas price.
- **VRF fee.** Every randomness request is paid by the user in native BNB to the Chainlink VRF v2.5 direct-funding wrapper. Quote it with `vrfFeeAt(uint256 gasPrice)` (selector `0xa3eaf9d8`) via an `eth_call` at the current BSC gas price, on the contract you are about to call. Underpaying reverts; any excess is refunded by the Towack contract in the same tx.
- Exact TWAK approvals only, never unlimited (never `type(uint256).max`).

## Addresses (chain 56)

Mainnet contracts are **not deployed yet**. Until Towack publishes them, these are placeholders: do not send anything.

| Contract | Address |
|---|---|
| TowackLaunch | `<TOWACK_LAUNCH>` (pending mainnet deploy) |
| TowackGenesis | `<TOWACK_GENESIS>` (pending mainnet deploy) |
| DrawV2 | `<TOWACK_DRAWV2>` (pending mainnet deploy) |
| TWAK token | `<TOWACK_TWAK>` (pending mainnet deploy) |
| TowackRouter | `<TOWACK_ROUTER>` (pending mainnet deploy) |
| PancakeSwap v2 router (quotes only) | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| WBNB | `<WBNB>` (fill from `addresses.json` `"56"`; do not guess) |

The authoritative list is `web/src/config/addresses.json` key `"56"` in the Towack repo. Never use a zero address or guess one.

## Flows

### Paid mint (Agent ID required), optionally with a referrer
1. `fee = TowackLaunch.vrfFeeAt(gasPrice)`.
2. `TowackLaunch.mint(address referrer)` payable (selector `0x6a627842`): `--inputData = 0x6a627842 ++ abi.encode(referrer)`, `--value = 100000000000000000 + fee` (0.1 BNB + VRF fee). One mint per Agent ID wallet.
   - No referrer: `referrer = address(0)` → `--inputData 0x6a6278420000000000000000000000000000000000000000000000000000000000000000`. (The zero-arg `mint()`, `0x1249c58b`, is equivalent.)
   - With a referrer (from a friend's link `/r/<handle>?ref=<address>` or `/mint?ref=<address>`): use exactly that `ref` address. Handles like `name.ai` are labels only; there is no on-chain resolver, so never resolve a handle yourself — ask the user for the `ref` address.
   - The contract reverts with `SelfReferral()` if the referrer is the minting wallet and `ReferrerHasNoAgentId()` if the referrer holds no Agent ID. If the preview shows either, stop and tell the user (offer to mint with `address(0)` instead).
   - The referrer earns 0.005 BNB (5% of the 0.1 price) from the contract; the minter still pays 0.1 BNB + fee.
3. After Chainlink VRF lands the spin, on request: `TowackLaunch.claim()` (`--inputData 0x4e71d92d`, `--value 0`). BNB refund tiers: 0.095 / 0.07125 / 0.0475 / 0.02375 BNB (100/75/50/25% of the 0.095 residual).

### Claim referral BNB (referrers)
1. Optional: `TowackLaunch.referralUnclaimed(address)` (selector `0xf8ac915a`) via `eth_call`; if 0, stop. Other views: `referralEarned(address)`, `referralCount(address)`, `referees(address)`, `referrerOf(address)`.
2. `TowackLaunch.claimReferral()`: `--inputData 0xe02f1ebd`, `--value 0`. Pull-based, any phase, no deadline (never swept). Reverts `NothingToClaimReferral()` if zero.

### Genesis 300 (Agent ID required)
1. `fee = TowackGenesis.vrfFeeAt(gasPrice)`.
2. `TowackGenesis.mint(uint256 agentTokenId)` payable (selector `0xa0712d68`): ABI-encode the user's Agent ID token id; `--value = fee` (no mint price). One per Agent ID and per wallet.
3. Later: `TowackGenesis.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Draw V2 pool wheel (anyone, no Agent ID)
1. `TWAK.approve(DrawV2, amount)` (selector `0x095ea7b3`): `--to TWAK`, `--value 0`, exact `amount` (18 decimals).
2. `fee = DrawV2.vrfFeeAt(gasPrice)`.
3. `DrawV2.enter(uint256 amount)` payable (selector `0xa59f3e0c`): `--to DrawV2`, `--value = fee`.
4. Later: `DrawV2.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Buy TWAK (anyone; Agent ID wallets also earn rebates)
1. Quote: PancakeSwap v2 `getAmountsOut(amountBnb * 99 / 100, [WBNB, TWAK])` (selector `0xd06ca61f`) via `eth_call` (the router keeps a 1% fee from the BNB in).
2. `minTokensOut = quote * (100 - slippage%) / 100` (default 1%); `deadline = now + 600`.
3. `TowackRouter.buy(uint256 minTokensOut, uint256 deadline)` payable (selector `0xd6febde8`): `--to TowackRouter`, `--value = amountBnb` (wei).

### Sell TWAK
1. `TWAK.approve(TowackRouter, amount)` (selector `0x095ea7b3`): `--to TWAK`, `--value 0`, **exact** `amount`, never unlimited.
2. Quote: `getAmountsOut(amount, [TWAK, WBNB])`; `minBnbOut = quote * 99 / 100 * (100 - slippage%) / 100` (1% router fee on BNB out); `deadline = now + 600`.
3. `TowackRouter.sell(uint256 amountIn, uint256 minBnbOut, uint256 deadline)` (selector `0xd3c9727c`): `--to TowackRouter`, `--value 0`.

### Swap / bridge (anyone; third-party routes earn no Towack rebate)
The Towack `/swap` desk compares live quotes across PancakeSwap (v2/v3), Uniswap v3, and Relay (plus 0x / 1inch when API keys are configured), ranking by best net output after gas. BAW users execute the selected route on BNB Smart Chain mainnet (chain 56).

**Pre-flight rules:**
1. Origin chain is always BSC mainnet: `--binanceChainId 56`.
2. Developer Mode must be enabled in Binance App (`baw wallet settings --json`).
3. If the output token is unfamiliar, run the BAW token security audit pre-check first.
4. Exact ERC-20 approval only (never unlimited / max uint256).
5. Always re-quote immediately before constructing calldata; abort if price drifted beyond slippage tolerance.

#### 1. PancakeSwap v2 (same-chain swap)
- Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- Path: `[tokenIn, tokenOut]` or `[tokenIn, WBNB, tokenOut]`
- Quote: `getAmountsOut(amountIn, path)` via `eth_call`. Calculate `amountOutMin = quote * (10000 - slippageBps) / 10000`.
- If `tokenIn` is ERC-20: approve exact `amountIn` to Router (selector `0x095ea7b3`).
- Swap:
  - Native BNB in: `swapExactETHForTokens(amountOutMin, path, recipient, deadline)` (selector `0x7ff36ab5`), `--value = amountIn`.
  - Native BNB out: `swapExactTokensForETH(amountIn, amountOutMin, path, recipient, deadline)` (selector `0x18cbafe5`), `--value = 0`.
  - Token to Token: `swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, deadline)` (selector `0x38ed1739`), `--value = 0`.

#### 2. PancakeSwap v3 / Uniswap v3 (same-chain swap)
- PancakeSwap v3: QuoterV2 `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`, Router `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4`
- Uniswap v3: QuoterV2 `0x78D78E420Da98ad378D7799bE8f4AF69033EB077`, SwapRouter02 `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2`
- Quote: `quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96))` (selector `0xc6a5026a`). `amountOutMin = amountOut * (10000 - slippageBps) / 10000`.
- If `tokenIn` is ERC-20: approve exact `amountIn` to the Router.
- Swap: `router.multicall(deadline, [exactInputSingle, unwrapWETH9?])` (selector `0x5ae401dc`):
  - `exactInputSingle((tokenIn, tokenOut, fee, recipient, amountIn, amountOutMin, 0))` (selector `0x04e45aaf`). When output is native BNB, recipient is `0x0000000000000000000000000000000000000002` (the router itself).
  - Native output unwrap: `unwrapWETH9(amountOutMin, recipient)` (selector `0x49404b7c`).

#### 3. Relay (cross-chain bridge & swap via relay.link)
- Keyless public API: `https://api.relay.link`
- Supported destination chains: Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Polygon (137).
- Flow:
  1. Quote: `POST https://api.relay.link/quote` with `user`, `recipient`, `originChainId: 56`, `destinationChainId`, `originCurrency`, `destinationCurrency`, `amount`, `tradeType: "EXACT_INPUT"`, `slippageTolerance`.
  2. Verify all returned `steps[]` are kind `"transaction"` and target BSC (`chainId: 56`).
  3. If approve step present: execute exact ERC-20 approval for `amountIn` to the designated spender.
  4. For each tx step: preview -> wait for user explicit "yes" -> execute.
  5. Status tracking: poll `GET https://api.relay.link/intents/status/v2?requestId=<requestId>` every 3-5 seconds until terminal status (`success`, `refund`, or `failure`).

#### 4. BAW-Native Alternative (same-chain)
When not bridging, BAW's native routing can also be used directly:
`baw market-order quote --fromTokenQty <qty> --fromToken <in> --toToken <out> --binanceChainId 56 --slippage <slip> --json` -> preview -> explicit yes -> `baw market-order swap` -> poll order status.

### Retries
If a VRF answer is late, the contracts expose `retryPrize(address)` (Launch / Genesis) and `retrySpin(uint256)` (DrawV2); each sends `vrfFeeAt(gasPrice)` again. Same preview / confirm / execute rules.

## Risk

A game of chance, not an investment. Most spins pay back less than was put in. Not affiliated with Binance, BNB Chain, PancakeSwap or Chainlink.
