---
name: towack
description: Mint Towack (TWAK) slots (optionally with a referrer), claim Genesis 300, enter the Draw V2 pool wheel, claim prizes and referral BNB, and buy/sell TWAK through the Towack router on BNB Smart Chain mainnet using the official Binance Agentic Wallet (BAW) external-sign flow. Use when a user asks to mint, refer, spin, enter, claim, buy or sell on Towack with their Binance Agentic Wallet.
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

### Retries
If a VRF answer is late, the contracts expose `retryPrize(address)` (Launch / Genesis) and `retrySpin(uint256)` (DrawV2); each sends `vrfFeeAt(gasPrice)` again. Same preview / confirm / execute rules.

## Risk

A game of chance, not an investment. Most spins pay back less than was put in. Not affiliated with Binance, BNB Chain, PancakeSwap or Chainlink.
