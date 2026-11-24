---
name: towack
description: Mint Towack (TWAK) slots (optionally with a referrer), claim the free Genesis 300 (flat 20,000 TWAK, gas only), enter the Draw V2 pool wheel, claim prizes and referral BNB, buy/sell TWAK through the Towack router, swap or bridge tokens via PancakeSwap, Uniswap, and Relay, and (Agent ID holders) place or cancel Aster perpetual orders from the Towack /perps page (BAW signs only a trade-only Aster API-wallet approval) on BNB Smart Chain mainnet using the official Binance Agentic Wallet (BAW) external-sign flow. Use when a user asks to mint, refer, spin, enter, claim, buy, sell, swap, bridge, or trade perps on Towack with their Binance Agentic Wallet.
---

# Towack with Binance Agentic Wallet

Requires Binance's official skill: https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet
(flow reference: `references/external-sign.md` in that skill).

## Hard rules

- **Mainnet only.** BAW supports BNB Smart Chain mainnet only: always `--binanceChainId 56`. BAW cannot connect to the Towack website; website users connect a browser wallet instead.
- **The website never signs or broadcasts.** Towack's site only displays/copies instructions ("Give this to your AI agent" boxes). No keys, no server-side signing, no BAW CLI from the browser. All signing happens in the user's own BAW after their explicit confirmation.
- **Developer Mode first.** As soon as a request needs `contract-call` or `sign-message`, run `baw wallet settings --json` and check `devMode.enabled=true` and that `devMode.expiresAt` is in the future. If it is off or expired, tell the user to turn it on in the Binance App (Agentic Wallet management page → Settings → Developer Mode) and wait. It stays on for 7 days (each use extends it). If enabling is refused with `351804`, the wallet's balance is over the Developer Mode cap.
- **Agent ID check before gated mints.** Before a paid mint or a Genesis claim, run `baw wallet agent-id --json` (Binance's only supported Agent ID pre-check). If `claimed=false`, stop and tell the user to claim one in the Binance App (Wallet → Agent ID). Error `20003008` means the Agent ID service is temporarily down, **not** that the user has no Agent ID: retry later.
- **Your wallet address** for `--from` comes from `baw wallet address --json`.
- **Preview, then wait, then execute.** For every tx:
  1. `baw contract-call preview --binanceChainId 56 --from <wallet> --to <contract> --value <wei> --inputData <hex> --json`
  2. Show the user the parsed tx, the risks and `authorityChanges`. Wait for an explicit "yes".
  3. Only then `baw contract-call execute --requestId <requestId> --json`. Never execute without a fresh preview and the user's "yes"; a two-step flow (approve, then sell/enter) needs a preview + "yes" for **each** step.
- **Read the execute result.** `BROADCASTED` returns a `txHash`: check it on BscScan before reporting success. `PENDING_CONFIRMATION` means the user must approve the transaction in the Binance App first. Tell them, wait, then check the result. It is **not** a failure: never re-send it. If preview or execute returns an error, relay it exactly as returned. If execute says the preview expired, run preview again. The Binance App may label a pending call "High-risk transaction" (Developer Mode calls to a token with no price yet get this label even when the preview shows no risks): tell the user to check the amount and contract in the App before approving.
- **Explain a refused preview.** BAW reports a contract revert as `351805 "Transaction simulation failed: execution reverted"`. For a plain text revert it appends the text (e.g. `...: PancakeLibrary: INSUFFICIENT_LIQUIDITY`); for a custom error (all Towack errors, and TWAK's OpenZeppelin v5 ERC20 errors) it gives no reason. Then, before telling the user, run an `eth_call` with the same `to`, `data` and `value`, `from` = the user's wallet (for example `cast call <to> <data> --value <wei> --from <wallet> --rpc-url https://bsc-dataseed.bnbchain.org`). Match the first 4 bytes of the revert data against [Revert reasons](#revert-reasons) and say the reason in plain words. Never retry or alter the transaction to get around a revert.
- `--value` is raw wei (integer). Never pass a gas price.
- **VRF fee.** Every randomness request (paid mint, Draw V2 entry, retries; Genesis 300 has none) is paid by the user in native BNB to the Chainlink VRF v2.5 direct-funding wrapper. Quote it with `vrfFeeAt(uint256 gasPrice)` (selector `0xa3eaf9d8`) via an `eth_call` at `gasPrice = max(liveGasPrice * 3, 0.25 gwei)` (`0.25 gwei` = `250000000` wei), on the contract you are about to call. BAW often broadcasts above the base gas price; underpaying reverts, and any unused fee is refunded by the Towack contract in the same tx.
- Exact TWAK approvals only, never unlimited (never `type(uint256).max`).

## Addresses (chain 56)

Mainnet contracts are live on BNB Smart Chain (chain 56), deployed 23 Nov 2026, 7:17 PM PKT. Explorer: https://bscscan.com

| Contract | Address |
|---|---|
| TowackLaunch | `0xc102c1d5F308722d24850bb5ebF7214831D63E51` |
| TowackGenesis | `0x5B3028454a628F73A5fe9198DE4fddefCC43c73A` |
| DrawV2 | `0xdf4499f5690474F502a774eCF6B93E73f57944C8` |
| TWAK token | `0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494` |
| TowackRouter | `0x3e4a1E282a6fffB148ddeE01dFB85ca967b6C775` |
| RebateDistributor | `0x886e955A7B1f5027d029d2a47Dcd43ad6a1b73cf` |
| TeamVesting | `0x9d2a285d244689221cB49a60ed8C738A4219cEF3` |
| TimelockController | `0x6E908eE594B447efe7C70A50b17E9d583e674D60` |
| TWAK/WBNB Pancake pair | `0x8F64C0fef2f5Ff365C9a1E3D3c925a07078733Cc` |
| SPACE ID Agent ID (`HandleRegistry`) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| Chainlink VRF v2.5 Direct-Funding Wrapper | `0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94` |
| PancakeSwap v2 Router02 (quotes only) | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| PancakeSwap v2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |

The authoritative list is `web/src/config/addresses.json` key `"56"` in the Towack repo. Never use a zero address or guess one.

## Flows

### Paid mint (Agent ID required), optionally with a referrer
1. `fee = TowackLaunch.vrfFeeAt(max(liveGasPrice * 3, 0.25 gwei))`.
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
Completely free: the claim is **non-payable**, so always `--value 0` (attaching any BNB reverts). The user pays only ordinary network gas (~$0.002). Each claim sends a flat **20,000 TWAK** to the caller in the same transaction: no wheel, no Chainlink VRF, no fee quote, no second `claim()` step. 300 claims in total (6,000,000 TWAK budget); one per Agent ID and per wallet.
1. Easiest on mainnet (`HandleRegistry`): `TowackGenesis.mintByHandle()` (selector `0x748049f4`): `--inputData 0x748049f4`, `--value 0` (resolves `handleOf(msg.sender)` on-chain).
   Or `TowackGenesis.mint(uint256 agentTokenId)` (selector `0xa0712d68`): where `agentTokenId = uint256(keccak256(bytes(handle)))`, `--value 0`.
2. Nothing else to do: the 20,000 TWAK is already in the wallet once the tx confirms. Optional check: `hasMinted(address)` via `eth_call`.
If the preview reverts (`NotOpen`, `SoldOut`, `AlreadyMinted`, `TokenIdUsed`, `NotAgentOwner`), stop and tell the user. Do not attach BNB. The retired VRF Genesis `0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038` is closed and must not be used.

### Draw V2 pool wheel (anyone, no Agent ID)
1. `TWAK.approve(DrawV2, amount)` (selector `0x095ea7b3`): `--to TWAK`, `--value 0`, exact `amount` (18 decimals).
2. `fee = DrawV2.vrfFeeAt(max(liveGasPrice * 3, 0.25 gwei))`.
3. `DrawV2.enter(uint256 amount)` payable (selector `0xa59f3e0c`): `--to DrawV2`, `--value = fee`.
4. Later: `DrawV2.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Claim trader rebates (Agent ID wallets that traded through TowackRouter)
Rebates are paid per 7-day epoch (TWAK + BNB), pro-rata to the router fees each Agent ID wallet paid that week. Finished epochs never expire. Contract: RebateDistributor (see Addresses).
1. Find the epochs to claim (all `eth_call`, nothing sent):
   - `cur = currentEpoch()` (selector `0x76671808`). Only epochs `e < cur` are finished.
   - For each `e` in `0 … cur - 1`, include `e` if `feesOf(e, wallet)` (selector `0x6ccd6cfa`) `> 0` **and** `claimed(e, wallet)` (selector `0x120aa877`) is `false`.
   - Optional estimate: `claimable(wallet, e)` (selector `0x60efe334`) returns `(tokens, bnb)`. It returns 0 for a finished epoch nobody has checkpointed yet; `claim` checkpoints first, so still include it.
   - If the list is empty, stop and tell the user there is nothing to claim.
2. `RebateDistributor.claim(uint256[] epochs)` (selector `0x6ba4c138`): `--to RebateDistributor`, `--value 0`, `--inputData = selector ++ abi.encode(uint256[] epochs)`. Show the user the epoch list and the estimate before the preview. It reverts `EpochNotFinished(e)` for an epoch that is not over yet.

### Buy TWAK (anyone; Agent ID wallets also earn rebates)
Trading opens only after the paid-mint window closes and `TowackLaunch.finalizeListing()` runs (`TWAK.tradingOpen()` turns `true`). Before that, the buy/sell preview reverts: tell the user trading has not opened yet.
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
When not bridging, BAW's own routing can be used directly. It is not a `contract-call` (no Developer Mode, no preview command), and `market-order` has **no preview step**:
1. Run the BAW swap security pre-check (token audit) for any token that is not well known.
2. `baw market-order quote --fromTokenQty <qty> --fromToken <in> --toToken <out> --binanceChainId 56 [--slippage <slip>] --json`: show the user the quote (amounts are human-readable units; native BNB is `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`). Wait for an explicit "yes".
3. `baw market-order swap` with the same flags.
4. An `orderId` is **not** a completed swap: poll `baw market-order list --orderId <orderId> --json` until `status` is `FINISHED` or `FAILED`, then report.
Third-party routes (including this one) earn no Towack rebate.

### Retries
If a VRF answer is late, the contracts expose `retryPrize(address)` (Launch) and `retrySpin(uint256)` (DrawV2); each sends `vrfFeeAt(max(liveGasPrice * 3, 0.25 gwei))` again. Same preview / confirm / execute rules.

## Aster perps (`/perps`; agent path for Agent ID holders)

The `/perps` page shows live Aster perpetual markets from Aster's public API. Any wallet can trade there after setting up a trade-only Aster API wallet in the browser (`canWithdraw=false`); that key is kept in the user's browser and signs their Aster requests. The "Give this to your AI agent" box is shown to Agent ID holders only and produces a ready-made instruction for one specific order or cancel; this section describes that agent path.

**Aster orders are NOT a BNB Smart Chain contract call.** Never try `baw contract-call` for them. Aster runs its own order book. The supported agent path:

- BAW signs exactly **one** EIP-712 message (`baw sign-message`, `--binanceChainId 56`, `--signType EIP712`) that approves a **trade-only Aster API wallet** (agent key) the user's own AI agent generates and keeps locally.
- That API wallet signs each order (EIP-712, domain chainId 1666) after the user's explicit "yes" to that exact order.
- In the agent path, Towack never signs, never sends, never sees any key. BAW is mainnet-only.

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
| Public, no key | `GET /fapi/v3/exchangeInfo`, `/fapi/v3/ticker/24hr`, `/fapi/v3/premiumIndex` (mark, index, `lastFundingRate`, `nextFundingTime`) |
| Agent approval (public, main-wallet signature) | `POST /fapi/v3/registerAndApproveAgent` |
| Agent-signed | `POST /fapi/v3/order`, `DELETE /fapi/v3/order`, `POST /fapi/v3/leverage`, `POST /fapi/v3/marginType`, `GET /fapi/v3/openOrders`, `GET /fapi/v3/balance` |
| Docs | https://github.com/asterdex/api-docs (V3 futures) |

### Signing
EIP-712 typed data for every Aster signature: domain `{"name":"AsterSignTransaction","version":"1","chainId":<id>,"verifyingContract":"0x0000000000000000000000000000000000000000"}`, `primaryType` `Message`, types `Message: [{name:"msg",type:"string"}]`, `message: {"msg": <string>}`.

1. **Approve agent (once, BAW):** `msg = user=<BAW>&nonce=<µs>&agentName=towack-agent&agentAddress=<API wallet>&expired=<ms>&signatureChainId=56&canSpotTrade=false&canPerpTrade=true&canWithdraw=false&ipWhitelist=`, domain chainId **56**.
   `baw sign-message preview --binanceChainId 56 --signType EIP712 --message '{"method":"eth_signTypedData_v4","params":["<BAW>","<typed data JSON string>"]}' --json` → show `parsedMessage` + `risks` → wait for "yes" → `baw sign-message execute --requestId <id> --json` (if `PENDING_CONFIRMATION`, the user confirms in the Binance App, then `baw sign-message result --order-id <orderId> --json`). Use the 65-byte signature (append `27 + signatureRecovery` as one hex byte if BAW returns 64 bytes).
   Then `POST /fapi/v3/registerAndApproveAgent` (form body) with those fields + `signature`. The nonce must be within ~10 s of server time, so post promptly. Expect `{"code":200,"msg":"success"}`.
2. **Each request (API wallet key, local):** `msg = <params>&nonce=<µs>&user=<BAW>&signer=<API wallet>` (urlencoded, in that order), domain chainId **1666**. Send `msg&signature=0x…` as the `application/x-www-form-urlencoded` body (GET: query string). Nonce: microseconds, within 60 s, never reused.

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

## Revert reasons

First 4 bytes of the revert data from an `eth_call` (see "Explain a refused preview"). Arguments, where present, follow ABI-encoded.

| Selector | Error | Contract | Plain meaning |
|---|---|---|---|
| `0xddefae28` | `AlreadyMinted()` | Genesis / Launch | This wallet already claimed Genesis (or already did its one paid mint). |
| `0xddafad98` | `NotOpen()` | Genesis | The Genesis claim window is closed. |
| `0x52df9fe5` | `SoldOut()` | Genesis / Launch | No slots left. |
| `0x390772fc` | `NotAgentOwner()` | Genesis | The wallet does not own that Agent ID (or holds none). |
| `0x31950ee8` | `TokenIdUsed()` | Genesis | That Agent ID was already used for a Genesis claim. |
| `0x951b974f` | `MintNotOpen()` | Launch | The paid-mint window is not open (not started or ended). |
| `0xf947691f` | `NoAgentId()` | Launch | The minting wallet holds no Agent ID. |
| `0x96fe8cdd` | `WrongPhase(uint8)` | Launch | Wrong phase for this action (0 minting, 1 closed, 2 finalized). |
| `0xf7760f25` | `WrongPrice()` | Launch | `--value` is below 0.1 BNB. |
| `0xbcece03d` | `VrfFeeTooLow(uint256 sent, uint256 required)` | Launch / DrawV2 | The Chainlink fee in `--value` is too low: re-quote `vrfFeeAt` and preview again. |
| `0x55e8f70e` | `SelfReferral()` | Launch | The referrer is the minting wallet itself. |
| `0x4042fe11` | `ReferrerHasNoAgentId()` | Launch | The referrer wallet holds no Agent ID: offer to mint with `address(0)`. |
| `0x969bf728` | `NothingToClaim()` | Launch / DrawV2 | Nothing is owed to this wallet (yet). For DrawV2, the spin may still be waiting for Chainlink. |
| `0x646cf558` | `AlreadyClaimed()` | Launch | The prize was already claimed. |
| `0x689f0d83` | `NotAssigned()` | Launch | Chainlink has not answered yet: wait and retry later. |
| `0xf0f25a33` | `ClaimWindowClosed()` | Launch | The prize claim window has closed. |
| `0xdbe9051c` | `NothingToClaimReferral()` | Launch | No referral BNB waiting. |
| `0x3750d157` | `EntriesPaused()` | DrawV2 | New entries are paused by the Timelock. |
| `0xf562b2d5` | `EntryTooSmall(uint256 amount, uint256 min)` | DrawV2 | Below the 100 TWAK minimum. |
| `0x2642f430` | `EntryTooLarge(uint256 amount, uint256 max)` | DrawV2 | Above the current max entry (0.5% of the available pool). |
| `0xeb8e6ac3` | `PoolTooSmall(uint256 needed, uint256 available)` | DrawV2 | The pool can't cover a 10× win on this entry: enter less. |
| `0x6c3ad9d2` | `EpochNotFinished(uint256 epoch)` | RebateDistributor | That rebate week isn't over yet: drop it from the list. |
| `0xef664d6a` | `DailyLimitExceeded(uint256 wouldSpend, uint256 limit)` | TowackRouter | Over the wallet's own daily router limit. |
| `0x2c19b8b8` | `InsufficientOutput(uint256 out, uint256 min)` | TowackRouter | The price moved past the slippage limit: re-quote. |
| `0xb69ec3f0` | `PairLocked()` | TWAK | Trading has not opened yet (before listing). |
| `0xfb8f41b2` | `ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)` | TWAK (OpenZeppelin v5) | The approve step is missing or too small: approve the exact amount for that spender first. |
| `0xe450d38c` | `ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)` | TWAK (OpenZeppelin v5) | The wallet holds less TWAK than the amount. |
| `0x08c379a0` | `Error(string)` | any | A plain text error, e.g. `"PancakeLibrary: INSUFFICIENT_LIQUIDITY"` when buying before listing (no liquidity yet). |

## Risk

A game of chance, not an investment. Most spins pay back less than was put in. Not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink or Aster.
