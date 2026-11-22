# Towack (TWAK) — contract architecture

All contracts: Solidity 0.8.24, OpenZeppelin v5.4.0, no proxies, no owner on anything that holds user funds.

## Deploy order (see `script/DeployTestnet.s.sol`)
1. `MockAgentId` (testnet only, if no real registry given). VRF is always the **official Chainlink VRF v2.5 coordinator** with an existing native-payment subscription (`VRF_SUB_ID`); the script adds Launch + DrawV2 as consumers. There is no mock-coordinator fallback any more.
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
- `mint()`: 0.1 BNB **+ the Chainlink VRF fee** (`vrfFeeAt(gasPrice)`, see Randomness → user-paid fee) for 80,000 TWAK, delivered instantly. Only the 0.1 BNB stays in the contract; the fee is forwarded to the VRF subscription and anything above `MINT_PRICE + fee` is refunded in the same tx (`msg.value < MINT_PRICE` → `WrongPrice`, fee not covered → `VrfFeeTooLow`). One per Agent ID holder (one ticket per address, because Agent IDs are soulbound). Cap 5000. Window `[mintStart, mintEnd)`. **Each mint makes its own VRF v2.5 request** (`PrizeRequested(minter, mintIndex, requestId)`).
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
- **VRF callback** (`_fulfillRandomWords`): ignores unknown, stale, or already-assigned requests (never reverts on them). Otherwise it computes `pick = word % remainingTotal` and walks the 11 remaining counts (packed 16 bits per tier in one storage word) to find the tier. It then decrements that count and `remainingTotal`, stores the prize on the ticket, and emits `PrizeAssigned(address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 bnbWei, uint256 bonusTokens)`. The callback is O(11). Worst case is the **first bonus draw on the longest walk** (id 9, 1.1×: 10-tier walk + `bonusAssigned`/`bonusOutstanding` 0 → non-zero): **131,772 gas cold incl. the official mock's overhead** (the no-win last slot is only 87,617). `callbackGasLimit` is **165,000** for new deploys (≥ 20% headroom, asserted in `test/OfficialVRF.t.sol`; the live testnet Launch was built with 300k). The callback pays nothing.
- **Randomness / MEV.** The VRF word is the only randomness and is used only as a uniform index into what is left of the deck. Mempool observers can't change the word, which is proven against the oracle key, and can't change whose request it answers, because the request id is bound to the minter at mint time. Fulfilment ordering only changes which deck state a draw sees, and every draw is uniform over that state. The remaining theoretical issue is callback gas, which is bounded as described above.
- `retryPrize(minter)` (**payable**: the caller pays the new request's VRF fee, excess refunded): permissionless, allowed after `VRF_RETRY_DELAY` (1h) with no answer. It re-requests and invalidates the old request id, so a late fulfilment of the old id is ignored. Caveat (Chainlink advises against re-requests): if a fulfilment were still sitting in the mempool after the delay, someone could front-run it with a retry to re-roll. The delay limits this to a VRF outage, and the retry exists so one stuck request can never block the listing forever.
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
- **Testnet Agent ID:** the existing MockAgentId is balance-only (no token ids), so Genesis on testnet uses a separate ERC-721 `MockAgentIdNFT` `0x70BC…8036` (first deployed by the now-removed `DeployGenesisTestnet.s.sol`; reused by `DeployOfficialVrfTestnet.s.sol`, which registers a fresh token id for the deployer).

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
- **Fulfil:** the callback pays `entry × m` into `owedTwak[player]` and releases the whole 10× reservation (the unused part goes back to available). Unknown or stale requests are ignored. `retrySpin(spinId)` (anyone, after 1h) keeps the reservation, re-requests, and invalidates the old request id. `enter` and `retrySpin` are **payable**: `msg.value` pays the Chainlink VRF fee (excess refunded) and is excluded from `availableBnb` during the call, so it never becomes pot money. The callback costs about 146k gas cold on the worst case (first jackpot with a BNB bonus; **158,463 incl. coordinator-mock overhead**). `callbackGasLimit` is **200,000** for new deploys (the live official-VRF pool was built with 250k).
- **BNB pot** (router 30% fee share, 75 BNB at a paid-mint sellout, unclaimed V1 refunds via `receive()`): `availableBnb = balance − reservedBnb − outstandingBnb`. On entry, 2% of `availableBnb` is reserved as that spin's `bnbCap`. A 10× pays the full `bnbCap` (2% of the pot at entry), a 5× pays half (1%), and lower tiers pay no BNB. An empty pot gives a TWAK-only spin; it never reverts.
- **Claim:** pull-based `claim()` pays all owed TWAK + BNB. Events: `Entered`, `SpinRequested`, `SpinRetried`, `SpinAssigned`, `Claimed`, `PoolSeeded`.
- **Seed:** the intended seed is the 7% allocation (`PRIZE_ALLOCATION` = 70M, still bound via `TokenBound` on a full stack deploy, with constructor `presetToken_ = 0`). A stand-alone deploy passes `presetToken_` and is filled with `seed(amount)` (anyone may add; nobody can take out).
- **Owner (timelock):** `setEntriesPaused` only. Pending spins and claims keep working. There is no withdraw of TWAK or BNB.
- **Testnet lock:** the skeleton DrawV2 `0x5B3028454a628F73A5fe9198DE4fddefCC43c73A` holds the live 70M and has no withdraw, and `TowackLaunch.drawV2Treasury` is immutable, so sellout BNB still goes there. The new pool wheel is a separate deploy seeded with a **5M TWAK testnet stand-in** from the ecosystem/deployer wallet (`script/DeployOfficialVrfTestnet.s.sol`; the first, mock-VRF pool `0x66E8…0191` keeps its 5M because there is no withdraw) until a future full stack redeploy.

## Randomness: official Chainlink VRF v2.5
- **Consumer:** `src/VRFConsumerV25.sol` (abstract, ownerless, all config immutable). Requests use `requestRandomWords` with `extraArgs = ExtraArgsV1{nativePayment}`; only the configured coordinator may call `rawFulfillRandomWords`. The constructor now rejects non-production config: coordinator without code, zero key hash, `subId == 0`, confirmations outside 3..200, callback gas outside 50k..2.5M, `nativePayment == false`, fee gas-price floor 0 or above the cap. Trade-off vs Chainlink's `VRFConsumerBaseV2Plus`: no owner `setCoordinator`, so a Chainlink coordinator migration needs a consumer redeploy.
- **Interface:** `src/interfaces/IVRFCoordinatorV2Plus.sol` = request + subscription calls (`createSubscription`, `fundSubscriptionWithNative`, `addConsumer`, `removeConsumer`, `cancelSubscription`, `getSubscription`, `pendingRequestExists`, owner transfer). `test/OfficialVRF.t.sol` asserts the selectors and the `ExtraArgsV1` encoding are identical to `@chainlink/contracts` (`lib/chainlink-brownie-contracts` 1.3.0).
- **BSC testnet (97) production config:** coordinator `0xDA3b641D438362C440Ac5458c57e00a712b66700`, key hash `0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26` (50 gwei lane), `nativePayment: true` (tBNB, no LINK), 3 confirmations, `callbackGasLimit` 250,000. On-chain `s_config()` read 2026-11-22: min confirmations 3, max gas 2.5M, `gasAfterPaymentCalculation` 48,500, flat fee 0, native premium 60%.
- **User-paid VRF fee (new contracts; nothing deployed yet).** Users pay every randomness request; the deployer pays only deploy gas (plus a refundable subscription deposit, below). We **stay on the v2.5 native-payment subscription** rather than the VRFV2PlusWrapper (direct funding): the wrapper is the only contract with `calculateRequestPriceNative`, but it adds wrapper overhead, never refunds overpayment and is a separate per-network contract, while one subscription already serves all three consumers. So `VRFConsumerV25` quotes the coordinator's own formula and has the user fund the subscription at request time:
  - `vrfFeeAt(uint256 gasPrice)` (**the frontend calls this**; `vrfFee()` = `vrfFeeAt(tx.gasprice)` is a convenience only, `eth_call` often has gas price 0). `gp = clamp(gasPrice, minFeeGasPrice, maxFeeGasPrice)`; then, mirroring `VRFCoordinatorV2_5._calculatePaymentAmountNative` (BSC: L1 cost 0) on the FULL callback limit, `payment = gp × (gasAfterPaymentCalculation + 100,000 + callbackGasLimit) × (100 + nativePremiumPercentage) / 100 + 1e12 × fulfillmentFlatFeeNativePPM`, and `fee = payment × 1.15`. Premium / gasAfter / flat fee are read live from `s_config()`.
  - **Constants:** `COORDINATOR_OVERHEAD_GAS = 100,000` (not in `s_config`; Chainlink's BSC mainnet direct-funding table lists 99,500 native, our real testnet fulfilments implied ~73k). `FEE_BUFFER_BPS = 1,500` (15%): the gas side already assumes the full callback limit (real use 50–80% of it) and a generous overhead, so the buffer only has to absorb a fulfilment gas price above the request's.
  - **Clamp (immutable per deploy, new `VRFConfig` fields):** `minFeeGasPrice` = the price the Chainlink node actually fulfils at, so a low-priced user tx cannot underpay — **1 gwei on 97** (our fulfilments, while `eth_gasPrice` is ~0.3–0.4 gwei) and **0.1 gwei on 56** (13 sampled mainnet fulfilments on 2026-11-22, all at 0.1 gwei while `eth_gasPrice` was 0.05). `maxFeeGasPrice` = the key-hash lane max (50 gwei on 97, 200 gwei on 56): the node never fulfils above it, so charging more would be pure overpayment.
  - **Mock detection:** the official `VRFCoordinatorV2_5Mock` exposes a zeroed `s_config` (`maxGasLimit == 0`), so the quote switches to its billing `i_base_fee + (100k + limit) × i_gas_price`, +15%. Unknown coordinators (no `s_config`) get a conservative 100%-premium / 60k fallback.
  - **Collect → fund → request → refund:** `_requestRandomWordPaid(available)` reverts `VrfFeeTooLow(sent, required)` if `available < fee` (atomic: no TWAK moved, no ticket/spin, Launch BNB not taken), calls `fundSubscriptionWithNative{value: fee}(subId)` **before** `requestRandomWords`, emits `VrfFeePaid(payer, requestId, fee)`, and the caller refunds the excess last (`RefundFailed` if the caller can't receive; all paths are `nonReentrant`). Launch passes `msg.value − MINT_PRICE`, so the 0.1 BNB is never sent to the subscription.
  - **Subscription deposit:** Chainlink's node only processes a request while the sub holds its "minimum subscription balance" = `laneMax × (200,000 max verification gas + callbackGasLimit) × (100 + premium)/100` (docs: below it requests stay pending up to 24h). That is **0.032 tBNB on 97** and **0.128 BNB on 56** for one DrawV2 request (the largest limit). This is an operating deposit, not a cost: user fees are added on top and `cancelSubscription` returns the balance. Fees exceed actual billing (≈2× at normal gas), so the sub balance grows and the surplus belongs to the sub owner (deployer, later the timelock if transferred).
- **Tight per-contract callback limits (new deploys):** Launch **165,000**, Genesis **170,000**, DrawV2 **200,000**, vs worst cold callbacks incl. mock overhead 131,772 / 135,600 / 158,463 (≥ 20% headroom each; `MIN_CALLBACK_GAS` lowered to 50k). Real testnet fulfil txs for reference (whole tx incl. proof verification): Genesis 192,938 gas, DrawV2 165,707. OOG behaviour is unchanged: a spin/ticket stays pending with its reservation held and can be retried (paying a new fee).
- **Billing (native):** `payment = 1.6 × tx.gasprice × (48,500 + coordinator gas incl. callback)`; the coordinator reverts if `tx.gasprice` > 50 gwei. Measured on a real fulfilment on this coordinator: ≈73k coordinator gas + the callback. Worst Towack callbacks (cold): DrawV2 ≈143k, Genesis < 150k, Launch ≈58k. So a worst DrawV2 fulfilment ≈ 265k billed gas ≈ **0.00042 tBNB at 1 gwei** (observed BSC-testnet fulfilment price), ≈0.021 tBNB at the 50 gwei ceiling; max cost of a full 250k callback at the ceiling ≈ 0.030 tBNB.
- **Subscription (broadcast 2026-11-22, 18:30 PKT):** one native-payment subscription owned by the deployer. `subId` `108109298338446825657484225053166289400607095163447504257161866471831941368513`. Consumers: TowackGenesis `0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F`, DrawV2 `0xC6f7B7062757A0Aa9F91d4551B3C9ab73B0079Fd`. Funded 0.045 tBNB; 0.00059164 tBNB charged across two real fulfilments (remaining 0.04440836 tBNB). Recorded in `web/src/config/addresses.json` (`97.vrfSubId`) and `deployments/bsc-testnet.json` → `officialVrf`.
- **What stays on the mock (testnet only):** `TowackLaunch 0x3772…8b` was constructed against `MockVRFCoordinator 0x09d2…3F61` (owner-answered `fulfillPseudo`). It is ownerless, holds 650M TWAK and has one claimed paid mint, and VRF config is immutable, so paid V1 on testnet stays on the mock until a full token-stack redeploy is approved. The frontend never calls `fulfillPseudo`; it shows a "test randomness coordinator" note for any contract whose `vrfCoordinator()` is not the official one. Retired mock-VRF consumers: old Genesis `0x8da0…4E78` (closed, surplus swept) and old pool `0x66E8…0191` (5M locked, no withdraw).
- **Tests** use Chainlink's official `VRFCoordinatorV2_5Mock` with a native-funded subscription and `addConsumer` (fixture), fulfilled with `fulfillRandomWordsWithOverride`, which forwards exactly `callbackGasLimit` gas. `MockVRFCoordinator` is kept in `src/mocks` only because it is the live testnet Launch's coordinator; no test or script deploys it any more. The fork test (`BSC_FORK=1`) creates a sub on the **real** coordinator, funds it, adds consumers and makes 20 real `requestRandomWords` calls.

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
