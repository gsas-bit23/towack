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

## TowackGenesis ("Genesis 300", free mint, `src/TowackGenesis.sol`)
Separate from TowackLaunch: it does not touch the paid 5,000 mints, the paid deck, LP, DrawV2 or the bonus reserve. TWAK only: there are no payable functions and no BNB refunds.
- **Gate:** `mint(agentTokenId)` requires `IERC721(agentId).ownerOf(agentTokenId) == msg.sender`. Both the token id and the wallet are marked used. A used id moved to a new wallet is still blocked, and a wallet that already minted cannot use a second id.
- **Numbers:** cap 300; base **20,000 TWAK** sent at mint; one VRF v2.5 request per mint; the callback pops one slot from a fixed 300-slot deck (`word % remainingTotal`, 7 packed counts). The multiplier applies to the 20k base, so extra = (mult − 1) × 20k:

  | id | tier | slots | extra each | extra total |
  |---|---|---:|---:|---:|
  | 0 | 5× | 5 | 80,000 | 400,000 |
  | 1 | 3× | 10 | 40,000 | 400,000 |
  | 2 | 2× | 20 | 20,000 | 400,000 |
  | 3 | 1.5× | 40 | 10,000 | 400,000 |
  | 4 | 1.25× | 50 | 5,000 | 250,000 |
  | 5 | 1.1× | 75 | 2,000 | 150,000 |
  | 6 | no bonus | 100 | 0 | 0 |

  At sellout: base 6,000,000 + extra 2,000,000 = **8,000,000 TWAK budget**, which is **16%** of the 50M (5%) ecosystem allocation.
- **Funding / solvency:** the ecosystem wallet pre-funds the contract with `fund(8M)` (approve + `transferFrom`). `committed()` is everything the contract may still owe. While open, that is unminted base + extra of undrawn slots + assigned-but-unclaimed extra. Once closed, it is unclaimed extra + worst-case extra for pending VRF draws. `open()` and `mint()` require `balance ≥ committed()`. Total assigned can never exceed 8M.
- **Owner** (Ownable2Step; deployer first, can hand over to the timelock): `open()`, `close()` (the window also auto-closes at 300), and `sweepSurplus()`, which sends only `balance − committed()` to the immutable ecosystem wallet. `renounceOwnership` is disabled.
- `retryPrize(minter)` (anyone, after 1h) re-requests a stalled draw and invalidates the old request. `claim()` pulls the extra once it is assigned.
- **Testnet Agent ID:** the existing MockAgentId is balance-only (no token ids), so Genesis on testnet uses a separate ERC-721 `MockAgentIdNFT` deployed by `script/DeployGenesisTestnet.s.sol`.

## TowackRouter
- Agent ID-gated `buy` / `sell` via Pancake v2, with a 1% fee on the BNB leg. Fee split: 50% to RebateDistributor (forwarded immediately), 30% to DrawV2 and 20% to dev. The last two accrue in the router and are pushed by the permissionless `flushFees()`.
- Approvals are exact per swap and reset to 0. There is no unlimited-approval helper.
- Leash: `setDailyLimit(wei)` sets a limit on BNB-leg notional per UTC day. Decreases apply immediately; increases apply after 24h. Default is unlimited.

## RebateDistributor
- 100M TWAK over 104 weekly epochs. Each epoch's budget plus its BNB boost is split pro-rata by **fees paid** in that epoch. Empty epochs roll over. Claims are on-chain via `claim(epochs[])`. No staking.

## TeamVesting
- 50M TWAK. **Start = deploy timestamp.** Nothing vests during the 365-day cliff, then it vests linearly in daily steps over 1460 days. No listing unlock, no revocation.

## DrawV2 — instant pool wheel
Replaced the weekly burn raffle (no rounds, tickets, burns or USD price source any more).
- `enter(amount)`: the TWAK goes **into** the pool (not burned) and one VRF v2.5 word is requested immediately. The callback lands a 10,000-slot wheel paying a multiplier of that entry from the pool:

| id | multiplier | slots | p | p × m |
|---|---|---:|---:|---:|
| 0 | 0× | 2,100 | 21% | 0 |
| 1 | 0.5× | 3,200 | 32% | 0.16 |
| 2 | 1× | 2,200 | 22% | 0.22 |
| 3 | 1.5× | 1,400 | 14% | 0.21 |
| 4 | 2× | 800 | 8% | 0.16 |
| 5 | 5× | 200 | 2% | 0.10 |
| 6 | 10× jackpot | 100 | 1% | 0.10 |
| | | 10,000 | 100% | **0.95** |

  Expected TWAK return is exactly **95%**; the ~5% edge stays in the pool. 53% of spins pay less than the entry, 22% pay it back, 25% pay more.
- **Pool accounting:** `availableTwak = token.balanceOf(this) − reservedTwak − outstandingTwak`. `reservedTwak` = Σ 10 × entry over spins still waiting for VRF, and `outstandingTwak` = assigned but unclaimed prizes. Availability is measured before the entry is added.
- **Limits:** `MIN_ENTRY` = 100 TWAK. `MAX_PAYOUT_BPS` = 500, so a 10× win is at most 5% of `availableTwak`, and `maxEntry = availableTwak × 500 / 100,000` (0.5%). `enter` reverts with `PoolTooSmall` if `availableTwak < 10 × entry`, and with `EntryTooLarge` above `maxEntry`.
- **Fulfil:** the callback pays `entry × m` into `owedTwak[player]` and releases the whole 10× reservation (the unused part goes back to available). Unknown or stale requests are ignored. `retrySpin(spinId)` (anyone, after 1h) keeps the reservation, re-requests, and invalidates the old request id. The callback costs about 143k gas cold (limit 300k).
- **BNB pot** (router 30% fee share, 75 BNB at a paid-mint sellout, unclaimed V1 refunds via `receive()`): `availableBnb = balance − reservedBnb − outstandingBnb`. On entry, 2% of `availableBnb` is reserved as that spin's `bnbCap`. A 10× pays the full `bnbCap` (2% of the pot at entry), a 5× pays half (1%), and lower tiers pay no BNB. An empty pot gives a TWAK-only spin; it never reverts.
- **Claim:** pull-based `claim()` pays all owed TWAK + BNB. Events: `Entered`, `SpinRequested`, `SpinRetried`, `SpinAssigned`, `Claimed`, `PoolSeeded`.
- **Seed:** the intended seed is the 7% allocation (`PRIZE_ALLOCATION` = 70M, still bound via `TokenBound` on a full stack deploy, with constructor `presetToken_ = 0`). A stand-alone deploy passes `presetToken_` and is filled with `seed(amount)` (anyone may add; nobody can take out).
- **Owner (timelock):** `setEntriesPaused` only. Pending spins and claims keep working. There is no withdraw of TWAK or BNB.
- **Testnet lock:** the skeleton DrawV2 `0x5B3028454a628F73A5fe9198DE4fddefCC43c73A` holds the live 70M and has no withdraw, and `TowackLaunch.drawV2Treasury` is immutable, so sellout BNB still goes there. The new pool wheel is a separate deploy seeded with a **5M TWAK testnet stand-in** from the ecosystem/deployer wallet (`script/DeployGenesisTestnet.s.sol`) until a future full stack redeploy.

## Admin surface
| Contract | Admin | Power |
|---|---|---|
| TowackToken | none | — |
| TowackLaunch | none | — |
| TowackGenesis | Ownable2Step owner (deployer → timelock) | open/close window, sweep surplus above `committed()` to the ecosystem wallet |
| TowackRouter | none | — |
| RebateDistributor | deployer, set-once bind | none after bind |
| TeamVesting | deployer, set-once bind | none after bind |
| DrawV2 | TimelockController (48h) | pause / unpause new entries only (no withdraw) |
