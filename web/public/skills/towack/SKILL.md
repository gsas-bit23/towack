---
name: towack
description: Mint Towack (TWAK) slots (optionally with a referrer), claim Genesis 300, enter the Draw V2 pool wheel, claim prizes and referral BNB, buy/sell TWAK through the Towack router, swap or bridge tokens via PancakeSwap, Uniswap, and Relay, and (Agent ID holders) place or cancel Aster perpetual orders from the Towack /perps page (BAW signs only a trade-only Aster API-wallet approval) on BNB Smart Chain mainnet using the official Binance Agentic Wallet (BAW) external-sign flow. Use when a user asks to mint, refer, spin, enter, claim, buy, sell, swap, bridge, or trade perps on Towack with their Binance Agentic Wallet.
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
| SPACE ID Agent ID (`HandleRegistry`) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| Chainlink VRF v2.5 Direct-Funding Wrapper | `0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94` |
| PancakeSwap v2 Router02 (quotes only) | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| PancakeSwap v2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |

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
2. Easiest on mainnet (`HandleRegistry`): `TowackGenesis.mintByHandle()` payable (selector `0x748049f4`): `--inputData 0x748049f4`, `--value = fee` (no mint price; resolves `handleOf(msg.sender)` on-chain).
   Or `TowackGenesis.mint(uint256 agentTokenId)` payable (selector `0xa0712d68`): where `agentTokenId = uint256(keccak256(bytes(handle)))`, `--value = fee`. One per Agent ID and per wallet.
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

## Aster perps (`/perps`; agent path for Agent ID holders)

The `/perps` page shows live Aster perpetual markets from Aster's public API. Any wallet can trade there after setting up a trade-only Aster API wallet in the browser (`canWithdraw=false`); that key is kept in the user's browser and signs their Aster requests. The "Give this to your AI agent" box is shown to Agent ID holders only and produces a ready-made instruction for one specific order or cancel; this section describes that agent path.

**Aster orders are NOT a BNB Smart Chain contract call.** Never try `baw contract-call` for them. Aster runs its own order book. The supported agent path:

- BAW signs exactly **one** EIP-712 message (`baw sign-message`, `--binanceChainId 56`, `--signType EIP712`) that approves a **trade-only Aster API wallet** (agent key) the user's own AI agent generates and keeps locally.
- That API wallet signs each order (EIP-712, domain chainId 1666) after the user's explicit "yes" to that exact order.
- In the agent path, Towack never signs, never sends, never sees any key. BAW is mainnet-only; testnet testers use a browser wallet on `/perps` (Aster testnet).

### Hard rules (perps)
- The user's BAW address must already have **deposited USDT margin on Aster** (asterdex.com, same wallet). Until then every trading call returns `{"code":-5050,"msg":"This function can only be used after deposit"}`: stop and tell the user.
- Agent approval scope is fixed: `canSpotTrade=false`, `canPerpTrade=true`, `canWithdraw=false`, empty `ipWhitelist`, `expired` = now + 7 days (ms). Aster rejects very short expiries ("Agent expired time too short"). **Never** approve withdrawals.
- The API-wallet private key stays on the user's machine: never print it, never paste it in chat, never send it to Towack or anyone else.
- **One-way position mode only.** Orders are sent without `positionSide` (one-way / `BOTH`). Hedge mode is not supported in this build: if the account is in Hedge mode, stop and tell the user to switch to One-way mode on Aster.
- Every order, leverage change, margin-mode change and cancel: preview (market data + exact param string) → show the user → explicit "yes" for that exact request → send. A changed size/price/side needs a new preview and a new yes. Report Aster's response as returned; never auto-retry.
- Perps are leveraged: the user can lose their whole margin and be liquidated. Towack adds no fee and has **no** Aster rebate today; Agent ID only unlocks this agent path (any future rebate alignment is not promised).

### Endpoints
| What | Value |
|---|---|
| Mainnet REST | `https://fapi.asterdex.com` |
| Testnet REST (browser wallets only, not BAW) | `https://fapi.asterdex-testnet.com` |
| Public, no key | `GET /fapi/v3/exchangeInfo`, `/fapi/v3/ticker/24hr`, `/fapi/v3/premiumIndex` (mark, index, `lastFundingRate`, `nextFundingTime`) |
| Agent approval (public, main-wallet signature) | `POST /fapi/v3/registerAndApproveAgent` |
| Agent-signed | `POST /fapi/v3/order`, `DELETE /fapi/v3/order`, `POST /fapi/v3/leverage`, `POST /fapi/v3/marginType`, `GET /fapi/v3/openOrders`, `GET /fapi/v3/balance` |
| Docs | https://github.com/asterdex/api-docs (V3 futures) |

### Signing
EIP-712 typed data for every Aster signature: domain `{"name":"AsterSignTransaction","version":"1","chainId":<id>,"verifyingContract":"0x0000000000000000000000000000000000000000"}`, `primaryType` `Message`, types `Message: [{name:"msg",type:"string"}]`, `message: {"msg": <string>}`.

1. **Approve agent (once, BAW):** `msg = user=<BAW>&nonce=<µs>&agentName=towack-agent&agentAddress=<API wallet>&expired=<ms>&signatureChainId=56&canSpotTrade=false&canPerpTrade=true&canWithdraw=false&ipWhitelist=`, domain chainId **56**.
   `baw sign-message preview --binanceChainId 56 --signType EIP712 --message '{"method":"eth_signTypedData_v4","params":["<BAW>","<typed data JSON string>"]}' --json` → show `parsedMessage` + `risks` → wait for "yes" → `baw sign-message execute --requestId <id> --json` (if `PENDING_CONFIRMATION`, the user confirms in the Binance App, then `baw sign-message result --order-id <orderId> --json`). Use the 65-byte signature (append `27 + signatureRecovery` as one hex byte if BAW returns 64 bytes).
   Then `POST /fapi/v3/registerAndApproveAgent` (form body) with those fields + `signature`. The nonce must be within ~10 s of server time, so post promptly. Expect `{"code":200,"msg":"success"}`.
2. **Each request (API wallet key, local):** `msg = <params>&nonce=<µs>&user=<BAW>&signer=<API wallet>` (urlencoded, in that order), domain chainId **1666** (testnet: 714). Send `msg&signature=0x…` as the `application/x-www-form-urlencoded` body (GET: query string). Nonce: microseconds, within 60 s, never reused.

### Order params (`POST /fapi/v3/order`)
Send params in exactly this field order (it is the order the in-app box emits): `symbol, side, type, [timeInForce], quantity, [price], [stopPrice], [activationPrice], [callbackRate], [workingType], [reduceOnly]`. Never send a param the type does not use (Aster rejects extra params).

| `type` | Extra params |
|---|---|
| `LIMIT` | `timeInForce` (`GTC` \| `IOC` \| `GTX` post-only), `price` |
| `MARKET` | none (no `price` / `timeInForce`) |
| `STOP` (stop-limit) | `timeInForce` (`GTC` \| `IOC`), `price`, `stopPrice` [+ `workingType`] |
| `TAKE_PROFIT` (take-profit limit) | `timeInForce` (`GTC` \| `IOC`), `price`, `stopPrice` [+ `workingType`] |
| `STOP_MARKET` | `stopPrice` [+ `workingType`] |
| `TAKE_PROFIT_MARKET` | `stopPrice` [+ `workingType`] |
| `TRAILING_STOP_MARKET` | `callbackRate` (percent, 0.1–5, step 0.1) [+ `activationPrice`] [+ `workingType`] |

- `side` is `BUY` | `SELL`; `reduceOnly=true` is optional on any type. `workingType` is `CONTRACT_PRICE` (last price, default) or `MARK_PRICE`.
- Trigger direction: a stop `BUY` needs `stopPrice` above the reference price and a stop `SELL` below; a take-profit `BUY` needs it below and a take-profit `SELL` above.
- Floor `quantity` to `LOT_SIZE.stepSize` (market-executed types: `MARKET_LOT_SIZE`), `price` to `PRICE_FILTER.tickSize`; notional (`quantity × price`, or × mark price for market-executed types) must be ≥ `MIN_NOTIONAL.notional`.
- **Attached TP / SL** (optional): only **after the entry is accepted**, send each leg as its own `POST /fapi/v3/order`, **one at a time (not `batchOrders`)**, on the opposite side, same `quantity`, `reduceOnly=true`:
  - TP: `symbol, side=<opposite>, type=TAKE_PROFIT_MARKET, quantity, stopPrice=<TP> [, workingType], reduceOnly=true`
  - SL: `symbol, side=<opposite>, type=STOP_MARKET, quantity, stopPrice=<SL> [, workingType], reduceOnly=true`
- Margin mode (optional, first): `POST /fapi/v3/marginType` `symbol, marginType` (`ISOLATED` | `CROSSED`). If Aster rejects it (e.g. an open position or orders in the other mode), stop and tell the user.
- Leverage (optional, after margin mode, before the order): `POST /fapi/v3/leverage` `symbol, leverage` (integer 1–125, within the symbol's bracket).
- Cancel: `DELETE /fapi/v3/order` `symbol, orderId`.
- Each of these requests (margin mode, leverage, entry, each TP/SL leg, cancel) is signed separately as in Signing → 2, after the user's yes to the full preview.

## Risk

A game of chance, not an investment. Most spins pay back less than was put in. Not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink or Aster.
