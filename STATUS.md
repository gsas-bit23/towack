# Towack status

**Repo:** https://github.com/gsas-bit23/towack
**Milestone:** 1 — contracts on BSC testnet
**Do not start frontend** until Mateen picks a design template.

## Contracts (src/)
| Contract | Purpose |
|---|---|
| `TowackToken` | ERC-20, 1B fixed supply minted to allocation recipients in the constructor. No tax, no owner. One-way pre-listing pair guard (see docs). |
| `TowackLaunch` | Mint (0.1 BNB → 80k TWAK, 1 per Agent ID, cap 5000). Close burns unsold tokens. One VRF v2.5 request. Fixed slot tables via seeded swap-or-not bijection. Pull claims. Lists on Pancake v2 at the mint price with LP burned to `address(0)`. Leftover BNB goes to DrawV2. 180-day claim window, then a sweep. **No owner.** |
| `TowackRouter` | Agent ID-gated buy/sell via Pancake v2. 1% BNB-leg fee split 50/30/20 (rebates / DrawV2 / dev). Exact approvals only. Leash daily limits: decreases immediate, raises after 24h. Records volume and fees. **No owner.** |
| `RebateDistributor` | 100M TWAK over 104 weekly epochs, pro-rata to router fees paid, plus the 50% BNB fee boost. Empty epochs roll over. On-chain claims. |
| `TeamVesting` | 50M TWAK. Start = deploy. 1-year cliff (nothing unlocks at the cliff), then linear daily over 4 years. |
| `DrawV2` | MVP weekly draw: burn TWAK for tickets at $1 = 1 ticket. The price input is a setter or price source behind a 48h `TimelockController`. VRF picks the winner. Prize = 700k TWAK + 20% of the free BNB pot. Owner cannot withdraw. |
| `VRFConsumerV25`, `TokenBound`, `libraries/SwapOrNot` | Shared bases and the shuffle library. |
| `interfaces/` | `IAgentId`, Pancake v2 factory/pair/router/WBNB, VRF v2.5 coordinator. |
| `mocks/` | `MockAgentId` (soulbound), `MockVRFCoordinator` (owner-fulfilled, **not secure**), Pancake v2 + WBNB mocks (tests only). |

Design details: `docs/ARCHITECTURE.md`.

## Test results (2026-11-22, forge 1.10.0)
- `forge test -vv`: **60 passed, 0 failed, 1 skipped.** The skip is the fork test, which is gated on `BSC_FORK=1`.
- Fuzz pass at `FOUNDRY_FUZZ_RUNS=2000`: **6/6 fuzz tests passed.** These cover:
  - draw solvency: BNB paid ≤ proceeds, bonuses ≤ reserve, exact per-tier slot counts, contract ends empty after all claims, N = 1..300
  - tier totals bounded for N = 1..5000
  - shuffle is a bijection
  - assembly shuffle == reference implementation
  - router fee split conserves the fee
  - vesting is monotonic
- The sellout test mints 5000 and claims 5000. It checks exact counts (500/600/800/1600/1500 and 20/40/80/160/320/400/3980), 175 BNB prizes, 35.2M bonus paid with 14.8M burned, LP of 250 BNB + 200M TWAK, and 75 BNB to DrawV2.
- `BSC_FORK=1` fork test against the **real PancakeSwap v2 testnet** factory and router: **passed.** Listing via `pair.mint(address(0))` works, all LP sits at `address(0)`, the router buy and sell work, and no allowance is left over.
- `forge script` dry-run on a BSC testnet fork: **succeeded** (~14.7M gas total).
- Test coverage areas: mint gate, one mint per ID, wrong price, mint window, cap, undersell burn, zero-mint burn, single VRF request, only-coordinator, retry and stale fulfilment, finalize-once, claims and double claim, non-minter, sweep, pair guard, router fee split, slippage, exact-approval checks, daily limits and raise delay, rebate pro-rata, carry and no sit-and-earn, vesting cliff/linear/full, DrawV2 timelock setter, tickets, draw/settle/claim.

## Slither (slither-analyzer, `--exclude-informational --exclude-low`, src only)
18 results, all reviewed. None needed a code change:
- `arbitrary-send-eth` on `_sendBnb`: destinations are only `msg.sender` (their own prize) or the immutable DrawV2 treasury.
- `reentrancy-balance` / `reentrancy-no-eth`: every external call path is `nonReentrant`. The callees are trusted Pancake or Chainlink. VRF fulfilment is async, and stale or unknown request ids are ignored.
- `divide-before-multiply` in vesting and emissions: intentional (whole-day steps; last-epoch remainder).
- `incorrect-equality` (`== 0` checks), `uninitialized-local` (zero-initialised accumulators), `unused-return` (`pair.mint`): benign.

## Deploy status
**Not deployed.** A new deployer key was generated at `/workspace/secrets/towack-deployer.env` (mode 0600, outside the repo, never committed or printed). Address: `0x38A0f77Dad60B34cF5cD39305687e354696a6776`. BSC testnet balance is **0 tBNB**, so broadcast was not attempted. Official and major third-party faucets (BNB Chain, QuickNode, Chainstack) require a mainnet token balance, account login, wallet connect, and/or a captcha, so funding is blocked pending a human claim. Do not spend real BNB to satisfy faucet anti-bot rules.

The script is ready (`script/DeployTestnet.s.sol`, chainid 97 only):
- By default it deploys `MockAgentId` and `MockVRFCoordinator`. The mock VRF lets the deployer choose randomness, so it is **testnet only**.
- For real VRF, set `VRF_COORDINATOR`, `VRF_KEY_HASH` and `VRF_SUB_ID` using the official Chainlink VRF v2.5 BSC testnet values from docs.chain.link (not yet looked up or verified here). Then add `TowackLaunch` and `DrawV2` as consumers on the subscription.
- For a real Agent ID registry, set `AGENT_ID`. The mainnet registry is `0x60B9…022F`; it is configurable and never hardcoded.

## Known gaps / decisions to confirm
- **Pair guard** makes the token slightly non-standard before listing: transfers *to the pair* are blocked until listing. This is needed to stop pool pre-seeding. Everything else is plain ERC-20.
- The **bind step** (deployer, set-once) exists because the token mints to contracts that must exist first. After binding, the deployer has no powers.
- **Leash** limits are keyed by holder address, on the assumption that Agent IDs are soulbound (1 address = 1 ID). Default is unlimited; users opt in.
- **Rebates**: epoch 0 starts at deploy. Pre-listing epochs roll into the first epoch with trades. Wash trading costs 1% per leg, but if the TWAK budget is worth more than about 50% of the fees, washing can be profitable. Consider capping per-epoch emissions relative to fees.
- **DrawV2** is an MVP: single winner per round, no TWAP oracle implementation yet (`ITwakPriceSource` interface only), and the 20% BNB-pot policy is a placeholder. Prizes a winner never claims stay owed forever.
- Seasons/referrals, ecosystem and POL buffer are plain recipient wallets. Use multisigs on mainnet.
- No external audit. VRF retry after 24h lets anyone re-request if Chainlink stalls; Chainlink advises against re-requests. This was accepted to avoid a permanent lock.
- The mainnet deploy script is intentionally not written.

## Next steps
1. Fund deployer `0x38A0f77Dad60B34cF5cD39305687e354696a6776` with testnet BNB (human faucet claim), then broadcast the testnet deploy. Optionally use a real VRF subscription and verify on testnet BscScan.
2. End-to-end testnet rehearsal: mint, close, fulfil, finalize, claims, router trades, rebate claim.
3. Implement or choose a TWAP price source for DrawV2. Review the rebate anti-wash parameters.
4. **Next milestone: frontend, AFTER Mateen picks a template.** Do not build it before then.
