# Towack (TWAK) — contract architecture

All contracts: Solidity 0.8.24, OpenZeppelin v5.4.0, no proxies, no owner on anything that holds user funds.

## Deploy order (see `script/DeployTestnet.s.sol`)
1. `MockAgentId` / `MockVRFCoordinator` (testnet only, if no real addresses given)
2. `TimelockController` (48h, proposer/executor = deployer, no admin)
3. `DrawV2(owner = timelock)`, `TowackLaunch`, `RebateDistributor`, `TeamVesting`
4. `TowackToken(recipients, pancakeFactory, wbnb)`: mints the full 1B supply and creates the TWAK/WBNB pair
5. `bindToken` on Launch / TeamVesting / DrawV2. This is set-once, deployer-only, and checks the exact allocation balance.
6. `TowackRouter`, then `RebateDistributor.bind(token, router)` (set-once)

## Allocations (minted in the token constructor)
| Recipient | Amount | % |
|---|---|---|
| TowackLaunch (public mint 400M + Draw V1 bonus 50M + initial LP 200M) | 650M | 65 |
| RebateDistributor | 100M | 10 |
| TeamVesting | 50M | 5 |
| DrawV2 | 70M | 7 |
| Seasons/referrals wallet | 50M | 5 |
| Ecosystem/dev wallet | 50M | 5 |
| POL buffer wallet | 30M | 3 |

## TowackToken
A standard ERC-20 with burn, no tax, no owner, and no mint after the constructor. It has one non-standard behaviour, a **one-way pre-listing pair guard**: until `TowackLaunch` seeds the pool, only the launch contract can transfer TWAK *into* the pair. Without the guard, a minter could pre-seed the pool at a manipulated price, and the listing would then be skewed or would revert.

## TowackLaunch (mint + Draw V1 prize wheel + listing)
- `mint()`: 0.1 BNB for 80,000 TWAK, delivered instantly. One per Agent ID holder (one ticket per address, because Agent IDs are soulbound). Cap 5000. Window `[mintStart, mintEnd)`. **Each mint makes its own VRF v2.5 request** (`PrizeRequested(minter, mintIndex, requestId)`).
- **Prize deck.** One immutable deck of 5,000 slots; each mint pops exactly one slot, so prizes are mutually exclusive (the wheel has one needle):

| id | Prize | Slots | Pays |
|---|---|---|---|
| 0 | Full refund | 500 | 0.1 BNB |
| 1 | 75% refund | 600 | 0.075 BNB |
| 2 | 50% refund | 800 | 0.05 BNB |
| 3 | 25% refund | 1,600 | 0.025 BNB |
| 4 | 5× | 20 | +320,000 TWAK |
| 5 | 3× | 40 | +160,000 TWAK |
| 6 | 2× | 80 | +80,000 TWAK |
| 7 | 1.5× | 160 | +40,000 TWAK |
| 8 | 1.25× | 320 | +20,000 TWAK |
| 9 | 1.1× | 400 | +8,000 TWAK |
| 10 | Better luck next time | 480 | — |

  Full deck: 175 BNB of refunds and 35.2M TWAK of bonuses. Bonuses come from the 50M reserve, on top of the 80k minted.
- **VRF callback** (`_fulfillRandomWords`): ignores unknown, stale, or already-assigned requests (never reverts on them). Otherwise it computes `pick = word % remainingTotal` and walks the 11 remaining counts (packed 16 bits per tier in one storage word) to find the tier. It then decrements that count and `remainingTotal`, stores the prize on the ticket, and emits `PrizeAssigned(address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 bnbWei, uint256 bonusTokens)`. The callback is O(11), and gas was measured at ~58k with cold storage on the worst-case walk. `callbackGasLimit` is 300k. The callback pays nothing.
- **Randomness / MEV.** The VRF word is the only randomness and is used only as a uniform index into what is left of the deck. Mempool observers can't change the word, which is proven against the oracle key, and can't change whose request it answers, because the request id is bound to the minter at mint time. Fulfilment ordering only changes which deck state a draw sees, and every draw is uniform over that state. The remaining theoretical issue is callback gas, which is bounded as described above.
- `retryPrize(minter)`: permissionless, allowed after `VRF_RETRY_DELAY` (1h) with no answer. It re-requests and invalidates the old request id, so a late fulfilment of the old id is ignored. Caveat (Chainlink advises against re-requests): if a fulfilment were still sitting in the mempool after the delay, someone could front-run it with a retry to re-roll. The delay limits this to a VRF outage, and the retry exists so one stuck request can never block the listing forever.
- `claim()`: pull-based and available as soon as the prize is assigned, even during the mint. Each refund is at most the minter's own 0.1 BNB, so `balance ≥ bnbOutstanding` always holds. A double claim reverts, and a no-win claim reverts with `NothingToClaim`. Claims close 180 days after listing.
- `closeMint()`: anyone can call it after `mintEnd` or at sellout. It burns unsold mint tokens (80k × unsold). With zero mints it burns all 650M.
- `finalizeListing()`: requires the mint to be closed **and** `mintCount == assignedCount` (no pending VRF; otherwise it reverts with `PrizesPending(n)`). It then:
  - burns the unassigned bonus reserve: `50M − bonusAssigned` (14.8M at sellout)
  - keeps `reserved = bnbOutstanding` (assigned, unclaimed refunds) in escrow; `leftover = balance − reserved`
  - lists at 800,000 TWAK/BNB: LP BNB = `min(leftover, 250)`, and unused LP TWAK is burned. It seeds the pair directly and calls `pair.mint(address(0))`. If leftover is 0, it lists nothing, burns the 200M, and still opens trading.
  - sends the rest of the leftover to DrawV2 and opens trading
  - At sellout this gives 250 BNB + 200M TWAK of LP, 75 BNB to DrawV2, and 175 BNB reserved until claimed.
  - **Undersold:** the deck is *not* rescaled. Slots never drawn are unsold, so their BNB was never reserved and flows to LP/DrawV2, and their bonus TWAK is burned.
- `sweepUnclaimed()`: after the claim window, unclaimed BNB goes to DrawV2 and unclaimed bonus TWAK is burned.
- Views: `prizeOf(minter) → (minted, assigned, prizeId, bnb, bonus, claimed)`, `tickets(minter)`, `remaining(id)`, `remainingCounts()`, `remainingTotal`, `pendingCount()`, `prizeSlots/prizeBnb/prizeBonus(id)`.
- `libraries/SwapOrNot` (the old single-seed shuffle) is no longer used by TowackLaunch. It is kept only with its own tests.

## TowackRouter
- Agent ID-gated `buy` / `sell` via Pancake v2, with a 1% fee on the BNB leg. Fee split: 50% to RebateDistributor (forwarded immediately), 30% to DrawV2 and 20% to dev. The last two accrue in the router and are pushed by the permissionless `flushFees()`.
- Approvals are exact per swap and reset to 0. There is no unlimited-approval helper.
- Leash: `setDailyLimit(wei)` sets a limit on BNB-leg notional per UTC day. Decreases apply immediately; increases apply after 24h. Default is unlimited.

## RebateDistributor
- 100M TWAK over 104 weekly epochs. Each epoch's budget plus its BNB boost is split pro-rata by **fees paid** in that epoch. Empty epochs roll over. Claims are on-chain via `claim(epochs[])`. No staking.

## TeamVesting
- 50M TWAK. **Start = deploy timestamp.** Nothing vests during the 365-day cliff, then it vests linearly in daily steps over 1460 days. No listing unlock, no revocation.

## DrawV2 (MVP)
- Weekly rounds. Players burn TWAK for tickets, at $1 of TWAK = 1 ticket. The price comes from `priceSource` (TWAP/oracle) or a manual `usdPerTwak`. Both setters are `onlyOwner`, and the owner is the 48h timelock.
- One VRF request per round. The winner is picked weighted by tickets, using a binary search over cumulative entries. The prize is 700k TWAK plus 20% of the free BNB pot.
- The owner has no withdraw function.

## Admin surface
| Contract | Admin | Power |
|---|---|---|
| TowackToken | none | — |
| TowackLaunch | none | — |
| TowackRouter | none | — |
| RebateDistributor | deployer, set-once bind | none after bind |
| TeamVesting | deployer, set-once bind | none after bind |
| DrawV2 | TimelockController (48h) | ticket price / price source only |
