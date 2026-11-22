---
name: towack
description: Mint Towack (TWAK) slots, claim Genesis 300, enter the Draw V2 pool wheel and claim prizes on BNB Smart Chain mainnet using the official Binance Agentic Wallet (BAW) external-sign flow. Use when a user asks to mint, spin, enter or claim on Towack with their Binance Agentic Wallet.
---

# Towack with Binance Agentic Wallet

Requires Binance's official skill: https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet
(flow reference: `references/external-sign.md` in that skill).

## Hard rules

- **Mainnet only.** BAW supports BNB Smart Chain mainnet only: always `--binanceChainId 56`. BAW does **not** support BSC testnet and cannot connect to the Towack website. Testnet testers must use MetaMask or another browser wallet on the website instead.
- **The website never signs.** Towack's site only displays/copies instructions. No keys, no server-side signing, no BAW CLI from the browser. All signing happens in the user's own BAW after their explicit confirmation.
- **Developer Mode first.** As soon as a request needs `contract-call`, run `baw wallet settings --json` and check `devMode.enabled=true`. If it is off, tell the user to enable Developer Mode in the Binance App and wait.
- **Preview, then wait, then execute.** For every tx:
  1. `baw contract-call preview --binanceChainId 56 --from <wallet> --to <contract> --value <wei> --inputData <hex> --json`
  2. Show the user the parsed tx, the risks and `authorityChanges`. Wait for an explicit "yes".
  3. Only then `baw contract-call execute --requestId <requestId> --json`.
- `--value` is raw wei (integer). Never pass a gas price.
- **VRF fee.** Every randomness request is paid by the user in native BNB to the Chainlink VRF v2.5 direct-funding wrapper. Quote it with `vrfFeeAt(uint256 gasPrice)` (selector `0xa3eaf9d8`) via an `eth_call` at the current BSC gas price, on the contract you are about to call. Underpaying reverts; any excess is refunded by the Towack contract in the same tx.
- Exact TWAK approvals only, never unlimited.

## Addresses (chain 56)

Mainnet contracts are **not deployed yet**. Until Towack publishes them, these are placeholders: do not send anything.

| Contract | Address |
|---|---|
| TowackLaunch | `<TOWACK_LAUNCH>` (pending mainnet deploy) |
| TowackGenesis | `<TOWACK_GENESIS>` (pending mainnet deploy) |
| DrawV2 | `<TOWACK_DRAWV2>` (pending mainnet deploy) |
| TWAK token | `<TOWACK_TWAK>` (pending mainnet deploy) |

The authoritative list is `web/src/config/addresses.json` key `"56"` in the Towack repo. Never use a zero address or guess one.

## Flows

### Paid mint (Agent ID required)
1. `fee = TowackLaunch.vrfFeeAt(gasPrice)`.
2. `TowackLaunch.mint()` payable: `--inputData 0x1249c58b`, `--value = 100000000000000000 + fee` (0.1 BNB + VRF fee). One mint per Agent ID wallet.
3. After Chainlink VRF lands the spin, on request: `TowackLaunch.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Genesis 300 (Agent ID required)
1. `fee = TowackGenesis.vrfFeeAt(gasPrice)`.
2. `TowackGenesis.mint(uint256 agentTokenId)` payable (selector `0xa0712d68`): ABI-encode the user's Agent ID token id; `--value = fee` (no mint price). One per Agent ID and per wallet.
3. Later: `TowackGenesis.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Draw V2 pool wheel (anyone, no Agent ID)
1. `TWAK.approve(DrawV2, amount)` (selector `0x095ea7b3`): `--to TWAK`, `--value 0`, exact `amount` (18 decimals).
2. `fee = DrawV2.vrfFeeAt(gasPrice)`.
3. `DrawV2.enter(uint256 amount)` payable (selector `0xa59f3e0c`): `--to DrawV2`, `--value = fee`.
4. Later: `DrawV2.claim()` (`--inputData 0x4e71d92d`, `--value 0`).

### Retries
If a VRF answer is late, the contracts expose `retryPrize(address)` (Launch / Genesis) and `retrySpin(uint256)` (DrawV2); each sends `vrfFeeAt(gasPrice)` again. Same preview / confirm / execute rules.

## Risk

A game of chance, not an investment. Most spins pay back less than was put in. Not affiliated with Binance, BNB Chain, PancakeSwap or Chainlink.
