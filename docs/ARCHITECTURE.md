# Towack (TWAK) — contract architecture

All contracts: Solidity 0.8.24, OpenZeppelin v5.4.0, no proxies, no owner on anything that holds user funds.

## Deploy order (see `script/DeployFullStackTestnet.s.sol`)
1. Agent ID registries (testnet: the existing mocks). VRF is the **official Chainlink VRF v2.5 direct-funding wrapper** (`VRF_WRAPPER`, default `0x4715…Ac94`). There is nothing to create or fund and no consumers to add.
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
- `mint(address referrer)` (zero-arg `mint()` = `mint(address(0))`, kept as a no-referrer convenience): 0.1 BNB **+ the Chainlink VRF fee** (`vrfFeeAt(gasPrice)`, see Randomness → user-paid fee) for 80,000 TWAK, delivered instantly. Only the 0.1 BNB stays in the contract; the fee is forwarded to the VRF subscription and anything above `MINT_PRICE + fee` is refunded in the same tx (`msg.value < MINT_PRICE` → `WrongPrice`, fee not covered → `VrfFeeTooLow`). One per Agent ID holder (one ticket per address, because Agent IDs are soulbound). Cap 5000. Window `[mintStart, mintEnd)`. **Each mint makes its own VRF v2.5 request** (`PrizeRequested(minter, mintIndex, requestId)`).
- **Referrals (paid mint only; Genesis has none).** A referred mint credits `REFERRAL_FEE` = 5% of the mint price = **0.005 BNB** to `referrer`, in BNB, pull-based:
  - `referrer == address(0)`: no referral; the 0.005 stays in the contract and flows to leftover (LP, then DrawV2) at finalize.
  - `referrer != address(0)`: reverts `SelfReferral()` if `referrer == msg.sender` (Agent IDs are soulbound, so same address == same Agent ID) and `ReferrerHasNoAgentId()` if `agentId.balanceOf(referrer) == 0`. A bad referrer is never silently ignored. Binds `referrerOf[minter] = referrer` (fixed: one mint per wallet), pushes the minter to `referees(referrer)`, and accrues 0.005 to `referralUnclaimed[referrer]`, `referralEarned[referrer]` (lifetime), `referralCount[referrer]`, `referralUnclaimedTotal` and `referralAccruedTotal`. Events: `ReferralBound(minter indexed, referrer indexed)`, `ReferralAccrued(referrer indexed, minter indexed, amount)`.
  - `claimReferral()` (nonReentrant): pays `referralUnclaimed[msg.sender]`, zeroes it, decrements `referralUnclaimedTotal`, emits `ReferralClaimed(referrer indexed, amount)`; `NothingToClaimReferral()` if zero. Works in every phase and has **no deadline**; referral balances are never swept.
  - **Where the 5% comes from.** It is carved out of the residual that would otherwise go to LP (then DrawV2), not a haircut after leftover. To keep the worst case (one referred mint drawing the top refund) solvent, every BNB refund tier is **95%** of its old value: 100/75/50/25% of the 0.095 residual (`MINT_PRICE − REFERRAL_FEE`). For every single mint, `prize BNB + REFERRAL_FEE ≤ MINT_PRICE`, so `address(this).balance ≥ bnbOutstanding + referralUnclaimedTotal` holds after every external call (fuzzed).
- **Prize deck.** One immutable deck of 5,000 slots; each mint pops exactly one slot, so prizes are mutually exclusive (the wheel has one needle):

| id | Prize | Slots | Pays |
|---|---|---|---|
| 0 | Full refund (100% of the 0.095 residual) | 500 | 0.095 BNB |
| 1 | 75% refund (of 0.095) | 600 | 0.07125 BNB |
| 2 | 50% refund (of 0.095) | 800 | 0.0475 BNB |
| 3 | 25% refund (of 0.095) | 1,600 | 0.02375 BNB |
| 4 | 5× | 20 | +320,000 TWAK |
| 5 | 3× | 40 | +160,000 TWAK |
| 6 | 2× | 80 | +80,000 TWAK |
| 7 | 1.5× | 160 | +40,000 TWAK |
| 8 | 1.25× | 320 | +20,000 TWAK |
| 9 | 1.1× | 400 | +8,000 TWAK |
| 10 | Better luck next time | 480 | — |

  Full deck: 166.25 BNB of refunds (`DECK_BNB_TOTAL` = 175 × 0.95) and 35.2M TWAK of bonuses. Bonuses come from the 50M reserve, on top of the 80k minted.
- **VRF callback** (`_fulfillRandomWords`): ignores unknown, stale, or already-assigned requests (never reverts on them). Otherwise it computes `pick = word % remainingTotal` and walks the 11 remaining counts (packed 16 bits per tier in one storage word) to find the tier. It then decrements that count and `remainingTotal`, stores the prize on the ticket, and emits `PrizeAssigned(address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 bnbWei, uint256 bonusTokens)`. The callback is O(11). Worst case is the **first bonus draw on the longest walk** (id 9, 1.1×: 10-tier walk + `bonusAssigned`/`bonusOutstanding` 0 → non-zero): **131,772 gas cold incl. the official mock's overhead** (the no-win last slot is only 87,617). `callbackGasLimit` is **165,000** for new deploys (≥ 20% headroom, asserted in `test/OfficialVRF.t.sol`; the live testnet Launch was built with 300k). The callback pays nothing.
- **Randomness / MEV.** The VRF word is the only randomness and is used only as a uniform index into what is left of the deck. Mempool observers can't change the word, which is proven against the oracle key, and can't change whose request it answers, because the request id is bound to the minter at mint time. Fulfilment ordering only changes which deck state a draw sees, and every draw is uniform over that state. The remaining theoretical issue is callback gas, which is bounded as described above.
- `retryPrize(minter)` (**payable**: the caller pays the new request's VRF fee, excess refunded): permissionless, allowed after `VRF_RETRY_DELAY` (1h) with no answer. It re-requests and invalidates the old request id, so a late fulfilment of the old id is ignored. Caveat (Chainlink advises against re-requests): if a fulfilment were still sitting in the mempool after the delay, someone could front-run it with a retry to re-roll. The delay limits this to a VRF outage, and the retry exists so one stuck request can never block the listing forever.
- `claim()`: pull-based and available as soon as the prize is assigned, even during the mint. Each refund is at most 0.095 BNB, and with the minter's referral (if any) at most the minter's own 0.1 BNB, so `balance ≥ bnbOutstanding + referralUnclaimedTotal` always holds. A double claim reverts, and a no-win claim reverts with `NothingToClaim`. Claims close 180 days after listing.
- `closeMint()`: anyone can call it after `mintEnd` or at sellout. It burns unsold mint tokens (80k × unsold). With zero mints it burns all 650M.
- `instantClose` (immutable, last constructor arg; **testnet rehearsal only**): when `true`, `closeMint()` may also run before `mintEnd` as soon as `mintCount >= 1`, so one paid mint + its VRF callback is enough to `closeMint()` + `finalizeListing()` and open trading immediately. Nothing else changes: same 0.1 BNB price, prize deck, VRF fee, `PrizesPending` gate and LP math (leftover = proceeds − reserved refunds − unclaimed referrals at 800,000 TWAK/BNB; leftover 0, e.g. a *referred* prize-0 mint, skips LP but still opens trading; an unreferred prize-0 mint now leaves 0.005 BNB for LP). Zero mints get no instant path: `closeMint()` still needs `mintEnd` and then takes the burn-everything route. Production / the live `addresses.json` stack use `false` (close only at/after `mintEnd` or at sellout). Deploy a rehearsal stack with `INSTANT_CLOSE=true script/DeployFullStackTestnet.s.sol` or `script/DeployRehearsalStackTestnet.s.sol` (chain 97 only, 7-day default window kept).
- `finalizeListing()`: requires the mint to be closed **and** `mintCount == assignedCount` (no pending VRF; otherwise it reverts with `PrizesPending(n)`). It then:
  - burns the unassigned bonus reserve: `50M − bonusAssigned` (14.8M at sellout)
  - keeps `reserved = bnbOutstanding + referralUnclaimedTotal` (assigned, unclaimed refunds + unclaimed referral BNB) in escrow; `leftover = balance − reserved` (never negative: per mint, prize + referral ≤ 0.1)
  - lists at 800,000 TWAK/BNB: LP BNB = `min(leftover, 250)`, and unused LP TWAK is burned. It seeds the pair directly and calls `pair.mint(address(0))`. If leftover is 0, it lists nothing, burns the 200M, and still opens trading.
  - sends the rest of the leftover (100% of what is left after the 250 BNB LP cap; never negative, shrinks as referrals accrue) to DrawV2 and opens trading
  - Conservation (no prize claims; referral claims added back): `bnbAssigned + lpBnb + sentToDrawV2 + referralAccruedTotal == mintCount × 0.1`.
  - Sellout, **no referrers**: leftover 500 − 166.25 = 333.75 → 250 BNB + 200M TWAK of LP, **83.75 BNB to DrawV2**, 166.25 BNB reserved until claimed.
  - Sellout, **every mint referred**: leftover 500 − 166.25 − 25 = 308.75 → 250 BNB LP, **58.75 BNB to DrawV2**, 25 BNB of referrals + 166.25 BNB of prizes reserved.
  - **Undersold:** the deck is *not* rescaled. Slots never drawn are unsold, so their BNB was never reserved and flows to LP/DrawV2, and their bonus TWAK is burned.
- `sweepUnclaimed()`: after the claim window, unclaimed **prize** BNB goes to DrawV2 and unclaimed bonus TWAK is burned. It sends `balance − referralUnclaimedTotal` and does not touch referral accounting, so unclaimed referral BNB stays claimable forever.
- Views: `prizeOf(minter) → (minted, assigned, prizeId, bnb, bonus, claimed)`, `tickets(minter)`, `remaining(id)`, `remainingCounts()`, `remainingTotal`, `pendingCount()`, `prizeSlots/prizeBnb/prizeBonus(id)`. Referral views: `referrerOf(minter)`, `referralUnclaimed(referrer)` (claimable), `referralEarned(referrer)` (lifetime), `referralCount(referrer)`, `referees(referrer) → address[]`, `referralUnclaimedTotal()`, `referralAccruedTotal()`, `REFERRAL_FEE()`.
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
- **Open** `buy` / `sell` via Pancake v2: any wallet can trade (no Agent ID gate; minting stays Agent ID-only on Launch and Genesis). 1% fee on the BNB leg of **every** trade. Fee split: 50% to RebateDistributor (forwarded immediately), 30% to DrawV2 and 20% to dev. The last two accrue in the router and are pushed by the permissionless `flushFees()`.
- **Rebate eligibility = Agent ID.** `_takeFee` checks `agentId.balanceOf(trader)`: Agent holders → `rebates.recordFee{value: 50%}(trader, fee)` (fee credit, earns TWAK + BNB). Non-Agent → `rebates.depositBoost{value: 50%}()`: the BNB joins the current epoch's pot with **no** fee credit, so non-Agent volume never dilutes Agent TWAK rebates and the non-Agent cannot claim. Router stats (`volumeOf`, `feesPaidOf`, `totalFees`, events) count every trader.
- Approvals are exact per swap and reset to 0. There is no unlimited-approval helper.
- Leash: `setDailyLimit(wei)` sets a limit on BNB-leg notional per UTC day. Decreases apply immediately; increases apply after 24h. Default is unlimited.

## RebateDistributor
- 100M TWAK over 104 weekly epochs. Each epoch's budget plus its BNB boost is split pro-rata by **fees paid** (Agent ID trades only) in that epoch. Empty epochs (no Agent fees) roll their TWAK and BNB, including non-Agent `depositBoost` BNB, into the next epoch. Claims are on-chain via `claim(epochs[])`. No staking.
- `recordFee` / `depositBoost` are `onlyRouter`. `setRouter(newRouter)`: deployer-only, non-zero, works before or after `bind` (fresh distributor can be wired before funding; a bound one can migrate routers without stranding the 100M). Trust assumption: the deployer chooses which router may record fees / deposit boosts; it cannot move tokens or BNB. `bind(token, router)` is unchanged (set-once token + router).
- Testnet migration script (code only): `script/DeployRouterTestnet.s.sol` (new RebateDistributor + open TowackRouter + `setRouter`; no 100M transfer, no `bind`). Keyless dryRun estimate: **2,906,359 gas ≈ 0.0029 tBNB @ 1 gwei**.

## Binance Agentic Wallet (AI agent) path
- BAW is mainnet-only (chain 56) and cannot connect to web pages. `/mint` (Genesis + paid mint) and `/lottery` offer **“Use with your AI agent”** next to wallet connect: a copyable instruction for an agent with Binance's official `binance-agentic-wallet` skill (Developer Mode check → `baw contract-call preview` → explicit user confirmation → `execute`; raw-wei value incl. `vrfFeeAt(gasPrice)`; no gas price). On testnet the panel says BAW does not support testnet and to use a browser wallet. Chain-56 addresses come from `addresses.json`; empty ones render as `<TOWACK_…>` placeholders “pending mainnet deploy”. The site only displays text: no signing, no BAW CLI. Skill file: `web/public/skills/towack/SKILL.md` → `/skills/towack/SKILL.md`.

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
- **BNB pot** (router 30% fee share, 83.75 BNB at a no-referrer paid-mint sellout / 58.75 BNB if every mint is referred, unclaimed V1 refunds via `receive()`): `availableBnb = balance − reservedBnb − outstandingBnb`. On entry, 2% of `availableBnb` is reserved as that spin's `bnbCap`. A 10× pays the full `bnbCap` (2% of the pot at entry), a 5× pays half (1%), and lower tiers pay no BNB. An empty pot gives a TWAK-only spin; it never reverts.
- **Claim:** pull-based `claim()` pays all owed TWAK + BNB. Events: `Entered`, `SpinRequested`, `SpinRetried`, `SpinAssigned`, `Claimed`, `PoolSeeded`.
- **Seed:** the intended seed is the 7% allocation (`PRIZE_ALLOCATION` = 70M, still bound via `TokenBound` on a full stack deploy, with constructor `presetToken_ = 0`). A stand-alone deploy passes `presetToken_` and is filled with `seed(amount)` (anyone may add; nobody can take out).
- **Owner (timelock):** `setEntriesPaused` only. Pending spins and claims keep working. There is no withdraw of TWAK or BNB.
- **Testnet lock:** the skeleton DrawV2 `0x5B3028454a628F73A5fe9198DE4fddefCC43c73A` holds the live 70M and has no withdraw, and `TowackLaunch.drawV2Treasury` is immutable, so sellout BNB still goes there. The new pool wheel is a separate deploy seeded with a **5M TWAK testnet stand-in** from the ecosystem/deployer wallet (`script/DeployOfficialVrfTestnet.s.sol`; the first, mock-VRF pool `0x66E8…0191` keeps its 5M because there is no withdraw) until a future full stack redeploy.

## Randomness: official Chainlink VRF v2.5 direct-funding wrapper (code complete, not yet redeployed)
- **Model:** every randomness request (paid Launch mint, Genesis mint, DrawV2 enter, and the three retries) goes through Chainlink's official **VRFV2PlusWrapper** (direct funding). It is paid in **native BNB, per request, by the user**. There is no subscription, no minimum-balance deposit, no `fundSubscriptionWithNative`, and no `addConsumer`. Official address (docs.chain.link/vrf/v2-5/supported-networks): **`0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94` on both BSC testnet (97) and BSC mainnet (56)**. On 97 its coordinator is `0xDA3b641D438362C440Ac5458c57e00a712b66700` and its key hash is the 50 gwei lane (`0x8596…0e26`). The key hash lives on the wrapper, not in our config.
- **Live wrapper config** (`getConfig()`, read 2026-11-22, identical on 97 and 56): wrapper gas overhead 13,400; coordinator native overhead 99,500; 435 per word; native premium 60%; flat fee 0; max 10 words. `typeAndVersion` = `VRFV2PlusWrapper 1.0.0`.
- **Consumer:** `src/VRFConsumerV25.sol` (abstract, ownerless, all config immutable). It follows the same pattern as Chainlink's `VRFV2PlusWrapperConsumerBase.requestRandomnessPayInNative`, re-implemented so that the hook keeps `calldata` words, nothing is owned, and the constructor does not call `wrapper.link()`.
  - `VRFConfig { wrapper, requestConfirmations, callbackGasLimit }`. The constructor requires that the wrapper has code, confirmations are in 3..200, and callback gas is in 50k..2.5M.
  - Getters: `vrfWrapper()`, `vrfRequestConfirmations()`, `vrfCallbackGasLimit()`. The old `vrfCoordinator / vrfKeyHash / vrfSubId / vrfNativePayment / vrfMin|MaxFeeGasPrice` are gone.
  - Only the wrapper may call `rawFulfillRandomWords`: `OnlyVRFWrapperCanFulfill(have, want)` (same name as Chainlink's base). The wrapper calls it with exactly `callbackGasLimit` (`_callWithExactGas`). A failing callback does not revert the fulfilment; the wrapper emits `WrapperFulfillmentFailed`. Callbacks stay a few SSTOREs and never revert on unknown or stale ids.
- **Fees:**
  - Quote (UI): `vrfFeeAt(gasPrice) = wrapper.estimateRequestPriceNative(callbackGasLimit, 1, gasPrice) × (1 + FEE_BUFFER_BPS)`, with `FEE_BUFFER_BPS = 1,000` (10%). `vrfFee()` is `vrfFeeAt(tx.gasprice)` and is a convenience only. `eth_call` usually has gas price 0, which makes the wrapper's `calculateRequestPriceNative` 0 off-chain, so **the frontend calls `vrfFeeAt(gasPrice)`**.
  - Wrapper formula: `price = gp × 13,400 + gp × (callbackGasLimit + 99,500 + 435 × numWords) × 1.6 (+ 1e12 × flatPPM)`.
  - Charge (on-chain): `_requestRandomWordPaid(available)` does the following:
    1. Computes `price = wrapper.calculateRequestPriceNative(limit, 1)` at the **request tx's real `tx.gasprice`**.
    2. Reverts `VrfFeeTooLow(available, price)` if `available < price`. This is atomic: no TWAK moves, no ticket or spin is created, and Launch BNB is not taken.
    3. Calls `requestRandomWordsInNative{value: price}(limit, 3, 1, ExtraArgsV1{nativePayment: true})`, sending **exactly `price`**. The wrapper keeps any overpayment and never refunds, so the buffer is never sent to it.
    4. Emits `VrfFeePaid(payer, requestId, price)`. The event amount is the exact wrapper price.
    5. Returns `(requestId, price)`. The caller refunds `available − price` last (`RefundFailed` if the caller can't receive; every path is `nonReentrant`).
  - What `available` is: Launch passes `msg.value − 0.1 BNB` (the mint price stays in Launch). Genesis, DrawV2, and all retries pass `msg.value`. DrawV2's `_availableBnb(msg.value)` excludes the current call's value, so **fees never enter the BNB pot**.
  - No gas-price floor or cap any more. The wrapper prices at request-time gas and its premium and overheads absorb fulfilment variance; the old subscription floor only existed because a sub is billed at fulfilment gas.
  - Gas spikes: a fee quoted at a lower gas price than the tx actually lands at can revert `VrfFeeTooLow` (tested: a 1 gwei quote fails at 5 gwei). The frontend quotes at `gasPrice × 1.25` and sends quote + 10%. With the contract's 10%, that covers a ~1.5× move, and everything unused is refunded in the same tx.
  - Examples at 1 gwei, exact price / UI quote: Launch 0.000437296 / 0.000481026, Genesis 0.000445296 / 0.000489826, DrawV2 0.000493296 / 0.000542626 BNB. At 0.1 gwei (mainnet-like) the prices are a tenth of that (0.0000437 / 0.0000445 / 0.0000493 BNB).
- **Callback limits (unchanged):** Launch **165,000**, Genesis **170,000**, DrawV2 **200,000**; `MIN_CALLBACK_GAS` 50k. Re-measured worst cold callbacks through the wrapper mock's exact-gas CALL (the gas the wrapper's CALL consumes, including cold-account access):
  - Launch **94,621**. The worst case is the first 1.1× bonus (id 9); the last no-win slot is 50,466 and the last 25% refund is 93,571.
  - Genesis **98,449** (last 1.1× slot).
  - DrawV2 **121,204** (first jackpot plus BNB).
  - Headroom is 43–65%. The older 131,772 / 135,600 / 158,463 figures included the subscription mock's own overhead.
  - The limits were kept rather than tightened. Each 10k of limit costs about 16k × gas price per request. They can be lowered later, but only with a fresh measurement.
  - The fork test also drives real fulfilments **through the real testnet wrapper** at 165k: all 20 Launch prizes are assigned and none emit `WrapperFulfillmentFailed`.
  - OOG behaviour: the spin or ticket stays pending with its reservation held and can be retried (the retrier pays a new fee).
- **`lastRequestId`:** the official wrapper only sets it on the LINK path, not on `requestRandomWordsInNative`. Our consumer uses the return value. The fork test caught this.
- **Interface:** `@chainlink/contracts/.../IVRFV2PlusWrapper.sol` (lib 1.3.0). `src/interfaces/IVRFCoordinatorV2Plus.sol` is kept for the `VRFV2PlusClient` encoding and for the live sub-model tooling.
- **Tests:**
  - `test/VRFWrapperMock.sol` mirrors the official wrapper:
    - It uses the same price formula with the live config, priced at `tx.gasprice`.
    - It requires `msg.value ≥ price` and keeps any overpayment.
    - It checks that `extraArgs` is a native `ExtraArgsV1`.
    - It answers via an exact-gas CALL that emits `WrapperFulfillmentFailed` on failure.
    - It exposes `link()` and `lastRequestId()`.
  - The fixture runs every test at `tx.gasprice = 1 gwei`.
  - `test/OfficialVRF.t.sol` covers: underpay on all six entry points; exact-price forwarding plus refunds (including fuzzing over the gas price); gas spikes; wrapper-only fulfil; stale and wrong-consumer answers; a wrapper that is down; reentrancy through an adversarial wrapper; and callback gas.
  - The fork test (`BSC_FORK=1`) uses the **real** testnet wrapper.
- **Live testnet (until Grok redeploys):** the deployed stack (Launch `0x45ff…8408`, Genesis `0x7f1F…03d1`, DrawV2 `0x4904…8c97`) is still the **subscription** build (`vrfCoordinator()`, sub `1081…8513`). The frontend's `VrfSource` reads `vrfWrapper()` first and falls back to `vrfCoordinator()`, so both builds render correctly. Older history: the subscription model (`ff8801e`/`6b07db1`) and the mock-VRF consumers are described in `STATUS.md`.

## Admin surface
| Contract | Admin | Power |
|---|---|---|
| TowackToken | none | — |
| TowackLaunch | none | — |
| TowackGenesis | Ownable2Step owner (deployer → timelock) | open/close window, sweep surplus above `committed()` to the ecosystem wallet |
| TowackRouter | none | — |
| RebateDistributor | deployer | set-once bind; `setRouter` (which router may record fees / boosts) |
| TeamVesting | deployer, set-once bind | none after bind |
| DrawV2 | TimelockController (48h) | pause / unpause new entries only (no withdraw) |
