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

## TowackLaunch (mint + Draw V1 + listing)
- `mint()`: 0.1 BNB for 80,000 TWAK, delivered instantly. One per Agent ID holder (`hasMinted[address]`, because Agent IDs are soulbound). Cap 5000. Window `[mintStart, mintEnd)`.
- `closeMint()`: anyone can call it after `mintEnd` or at sellout. It burns the unsold mint tokens and makes **one** VRF v2.5 request. If nothing sold, it burns all 650M.
- The VRF callback only stores the seed. `retryDraw()` is allowed after 24h without an answer, and only the latest request id is accepted.
- `finalizeDraw()`: anyone can call it. It:
  - computes the fixed slot counts `floor(N*slots/5000)`
  - burns the unused bonus reserve
  - lists at the mint price, 800,000 TWAK per BNB. LP BNB = `min(leftover after prizes, 250)`; unused LP TWAK is burned. It writes WBNB+TWAK straight into the pair and calls `pair.mint(address(0))`, which burns the LP tokens. A locker could replace `LP_RECIPIENT` later.
  - sends the remaining BNB to DrawV2 and opens trading
- Slot assignment: `SwapOrNot.permute(minterIndex, N, keccak(seed, tag))` is a seeded bijection on [0, N) (a swap-or-not shuffle, equivalent to Fisher-Yates). It uses two independent tags, one for the BNB table and one for the bonus table. Because it is a bijection, the slot counts are honoured exactly and payouts are solvent by construction.
- `claim()` is pull-based. Unclaimed prizes after 180 days: `sweepUnclaimed()` sends the BNB to DrawV2 and burns the TWAK.

| BNB refund | slots @5000 | | Token bonus | slots @5000 | extra TWAK |
|---|---|---|---|---|---|
| 100% (0.1) | 500 | | 5x | 20 | 320,000 |
| 75% | 600 | | 3x | 40 | 160,000 |
| 50% | 800 | | 2x | 80 | 80,000 |
| 25% | 1600 | | 1.5x | 160 | 40,000 |
| none | 1500 | | 1.25x | 320 | 20,000 |
| | | | 1.1x | 400 | 8,000 |

Sellout: 175 BNB of prizes, 250 BNB + 200M TWAK to LP, 75 BNB to DrawV2, and 35.2M bonus paid with 14.8M burned.

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
