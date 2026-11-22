# Towack status

**Repo:** https://github.com/gsas-bit23/towack
**Milestone:** 1 — instant per-mint prize-wheel contracts redeployed on BSC testnet (97); Arcade Sky frontend wired to the new addresses.

## Official Chainlink VRF v2.5 (deployed 2026-11-22, 18:30:04–18:30:55 PKT)
Genesis 300 and the DrawV2 pool wheel now use the **official** Chainlink VRF v2.5 coordinator on BSC testnet with one **native-payment (tBNB) subscription**. Paid TowackLaunch stays on MockVRF (see below). Record: `deployments/bsc-testnet.json` → `officialVrf`. Script: `script/DeployOfficialVrfTestnet.s.sol`. All deploy + rehearsal txs `status=0x1`. `--legacy --with-gas-price 1gwei --slow`. Never mainnet; no secrets printed or committed.

- **Config (97):** coordinator [`0xDA3b641D438362C440Ac5458c57e00a712b66700`](https://testnet.bscscan.com/address/0xDA3b641D438362C440Ac5458c57e00a712b66700), key hash `0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26` (50 gwei lane), `nativePayment: true`, 3 confirmations, `callbackGasLimit` **250k**. On-chain: min conf 3, max gas 2.5M, native premium 60%, flat fee 0, `gasAfterPaymentCalculation` 48.5k.
- **Subscription id:** `108109298338446825657484225053166289400607095163447504257161866471831941368513` (owner = deployer). [create](https://testnet.bscscan.com/tx/0x50a1481829b12596b9616d03474748c8012723fd5a98e2373ba1ab087e0b60a2) · [fund 0.045 tBNB](https://testnet.bscscan.com/tx/0xd7f5b772a47d32390cecce5c81e7aa20c086befd8761851798eceaf6e7f00b77). After two fulfilments the sub holds **0.04440836 tBNB** (charged **0.00059164**).
- **New Genesis** [`0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F`](https://testnet.bscscan.com/address/0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F) (create [tx](https://testnet.bscscan.com/tx/0x7fe454fb0dbf58dce2ba844a7a14b42296831b5dcfc982319f17cb21946deefa)), funded 8M, open. Sourcify **exact_match** (creation + runtime): [Genesis](https://repo.sourcify.dev/contracts/full_match/97/0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F/).
- **New DrawV2 pool** [`0xC6f7B7062757A0Aa9F91d4551B3C9ab73B0079Fd`](https://testnet.bscscan.com/address/0xC6f7B7062757A0Aa9F91d4551B3C9ab73B0079Fd) (create [tx](https://testnet.bscscan.com/tx/0x91aa2586a3f329324f7ee3f249551b24774cf4f1594d48563144e9d985766f0a)), owner = timelock, seeded 5M. Sourcify **exact_match** (creation + runtime): [DrawV2](https://repo.sourcify.dev/contracts/full_match/97/0xC6f7B7062757A0Aa9F91d4551B3C9ab73B0079Fd/).
- **Old mock-VRF consumers:** Genesis `0x8da0…4E78` [closed](https://testnet.bscscan.com/tx/0x1bc19e00c70aa7d8ab1e80f515512ec8c9af13c7ec28a8115df9a30f8cfffd37) and [swept](https://testnet.bscscan.com/tx/0xb2f3563762b95b5d17d6ad0017939c85289fea7881390f357719d912963507b6) 7,978,000 TWAK to the deployer. Pool `0x66E8…0191` left in place (5M+ locked, no withdraw). MockAgentIdNFT reused; deployer registered **token id 2** ([tx](https://testnet.bscscan.com/tx/0x7273de1738d22ff46971fc83e017b616e1ce73ff299657d10f7e517aacb3d7c7)).
- **Stays on mock VRF:** TowackLaunch [`0x37720d1a42E483fB36d09bc93596a2feF535FF8b`](https://testnet.bscscan.com/address/0x37720d1a42E483fB36d09bc93596a2feF535FF8b) (ownerless, 650M TWAK, immutable VRF → MockVRFCoordinator `0x09d2…3F61`). Paid V1 on testnet stays owner-fulfilled until Mateen approves a **full stack redeploy**.
- **Funding:** deployer 0.071230003 → **0.020915098** tBNB. Spent **0.045** to the coordinator (credited to the sub) + **0.004575628** deploy gas + **0.000739277** rehearsal gas = **0.050314905**. Leftover sub balance can be recovered later with `cancelSubscription` once no requests are pending.
- **Real VRF rehearsal (18:32:40–18:33:55 PKT):** callbacks landed in ~3 seconds (Chainlink node `0xa085…2b77`, 1 gwei). Genesis `mint(2)`: prizeId **5 (1.1×, +2,000 extra)**, claimed. [mint](https://testnet.bscscan.com/tx/0x6b380fa71e216d9caa5ed0c76ac93ada28fdc989634c3fa620fc803501210c02) · [VRF fulfill](https://testnet.bscscan.com/tx/0x7a37fdf8a6cb4fc24d15f749aada19456a3ba11aafff55a574f297182d9117d2) · [claim](https://testnet.bscscan.com/tx/0xb75036008ce6926ccc9ebc18028155e3929bd4a5ed680e7fa25d47899d2fce1a). DrawV2 `enter(1000 TWAK)`: prizeId **4 (2×, +2,000 TWAK)**, claimed; `availableTwak` 4,999,000. [approve](https://testnet.bscscan.com/tx/0x9490bcdd990ec85dc1162cc407f3ea83bc8865ddaf5381efa032f2a0afa21a46) · [enter](https://testnet.bscscan.com/tx/0xbe34f176f09527dd29dc7fe6d9443ccad3a4456345bf3990d33f30b146aaa27c) · [VRF fulfill](https://testnet.bscscan.com/tx/0x759cb0c43e8b4629f800ebf1ec5d800c4f8e357703fb08cb74d56b4a65e9b5b9) · [claim](https://testnet.bscscan.com/tx/0xf27df3d05f41d036a98787d20dc70733bdd0188de3b0fc58933d1b780652dcd2). Deployer TWAK after: **112,122,000**.
- **Tests:** official `VRFCoordinatorV2_5Mock` in the fixture (`lib/chainlink-brownie-contracts` 1.3.0). New `test/OfficialVRF.t.sol` covers encoding/selector parity, constructor validation, unadded-consumer atomic reverts, native billing, worst-case cold callback gas at 250k (DrawV2 ≈158k, Genesis ≈136k, Launch ≈88k incl. mock overhead), OOG-safe state, coordinator-only callback, stale/wrong-consumer ids, retry, reentrancy, pending-reservation fuzz. Independent review: **`forge test` 130 passed, 0 failed, 1 skipped**. **`FOUNDRY_FUZZ_RUNS=2000` 12/12 passed.** `npm run lint` clean.
- **Frontend:** `addresses.json` 97 filled (`genesis`, `drawV2`, `vrfSubId`). Old contracts at `genesisMock` / `drawV2Mock`. `VrfSource` badge reads `vrfCoordinator()` (“✓ Chainlink VRF v2.5” or a test-coordinator note for the live Launch). Wheels wait for `PrizeAssigned` / `SpinAssigned`; the app never calls `fulfillPseudo`. A new Vercel preview was not deployed in this round (current preview still points at the old mock-VRF Genesis/DrawV2 until one is cut).

## Genesis 300 free mint (first deploy 2026-11-22, 06:46:20 PKT; closed and replaced at 18:30 PKT)
The mock-VRF Genesis `0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78` below is **closed** (surplus swept). The live official-VRF Genesis is `0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F` — see the section above.
New contract `src/TowackGenesis.sol`. `TowackLaunch` and the paid 5,000-slot deck are **unchanged**. Details: `docs/ARCHITECTURE.md` → TowackGenesis.
- **Design:** 300 free mints for Agent ID holders (ERC-721 `ownerOf(tokenId)` gate; token id *and* wallet single-use). **20,000 TWAK** base at mint plus one VRF spin of a TWAK-only 300-slot deck: 5× ×5, 3× ×10, 2× ×20, 1.5× ×40, 1.25× ×50, 1.1× ×75, no bonus ×100. Extra = (mult − 1) × 20k, pulled with `claim()`. Base 6M + extra 2M = **8,000,000 TWAK budget = 16% of the 50M ecosystem allocation**, pre-funded via `fund()`. No BNB anywhere. Owner (Ownable2Step, deployer → timelock later) can open/close and sweep only surplus above `committed()` to the ecosystem wallet. `retryPrize` after 1h.
- **Tests (forge 1.10.0):** `forge test`: **89 passed, 0 failed, 1 skipped** (68 existing + 21 new in `test/TowackGenesis.t.sol`; skipped = gated fork test). `FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz`: **8/8 passed**, including the new `testFuzz_DeckInvariants` (K ≤ 300) and `testFuzz_MintFlowSolvent`.
- **Deployed (BSC testnet 97, `--legacy --with-gas-price 1gwei --slow`):** Genesis [`0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78`](https://testnet.bscscan.com/address/0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78) (create [tx](https://testnet.bscscan.com/tx/0x8a4afb1dbca0d96b3b637d283aa6bd234bdb3c9cd0b521416cac76a3fdf34422)), funded 8M and **open** (remaining 300, mintCount 0). Agent ID mock [`0x70BC7133E62427DAE709299454ed8c9015898036`](https://testnet.bscscan.com/address/0x70BC7133E62427DAE709299454ed8c9015898036) (id 1 to deployer). Sourcify **exact_match** (creation + runtime): [Genesis](https://repo.sourcify.dev/contracts/full_match/97/0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78/), [MockAgentIdNFT](https://repo.sourcify.dev/contracts/full_match/97/0x70BC7133E62427DAE709299454ed8c9015898036/). Full record: `deployments/bsc-testnet.json` → `genesis300AndDrawV2Pool`. Paid Launch still uses the original balance-only MockAgentId.
- **Frontend:** a Genesis 300 card at the top of `/mint` with claimed/300, copy, a 7-tier legend, an Agent ID token-id field (autofilled through `tokenOfOwnerByIndex` when the registry supports it), "Claim free + spin" (`mint(tokenId)`), and a Genesis-only `SpinWheel` (same component, Genesis table) that lands on the on-chain prizeId. It also has Claim bonus, Retry VRF and Share. The `?demo=genesis` demo is gated like the paid demo (`NEXT_PUBLIC_DEMO_WHEEL=1`). `addresses.json` 97.genesis is filled. The frontend reads the NFT registry from `genesis.agentId()`. ABI: `web/src/abi/TowackGenesis.ts`.
- **BonusBars:** each column now has a dedicated bar track (label above, counts below). Bars are 40–88% of the track only, so they step 37→82 px on a 360 phone and 52→114 px at 1440.
- **Web checks:** `npm run lint` clean; `NEXT_PUBLIC_DEMO_WHEEL=1 npm run build` green. Responsive audit (`responsive-audit.py --genesis`, 360×740 / 768×1024 / 1440×900 / 1920×1080, home + mint + Genesis demo): **0 horizontal-overflow, 0 tap-target-small**, and 0 flags on any `/mint` route. Home flags are the known hero sunburst false positives. Shots: `web/shots/responsive/genesis/`, best in `web/shots/responsive/after-best/{phone-mint-genesis-card,phone-genesis-wheel,desktop-mint-genesis}.png`.

## DrawV2 → instant pool wheel (deployed 2026-11-22, 06:46:20 PKT)
`src/DrawV2.sol` rewritten. The weekly burn raffle is gone: no rounds, tickets, burns, `usdPerTwak` or price source. Genesis, Launch, Token and Router are unchanged. Details: `docs/ARCHITECTURE.md` → DrawV2.
- **Model:** `enter(amount)` puts TWAK **into** the pool and requests one VRF word. The wheel pays a multiplier of that entry: 0× 2,100 / 0.5× 3,200 / 1× 2,200 / 1.5× 1,400 / 2× 800 / 5× 200 / 10× 100 (of 10,000 slots). **Expected return Σp·m = 95% exactly**; the ~5% edge stays in the pool. Pull `claim()`.
- **Limits / accounting:** min 100 TWAK. `MAX_PAYOUT_BPS` = 500, so a 10× win is ≤ 5% of `availableTwak` and max entry = 0.5% of it. Reverts if available < 10 × entry. `availableTwak = balanceOf(this) − reservedTwak (10× per pending spin) − outstandingTwak (assigned, unclaimed)`. Fulfil releases the reservation; `retrySpin` (1h, anyone) keeps it and invalidates the old request.
- **BNB pot:** bonus on 5× (1%) and 10× (2%) of `availableBnb` at entry only. The 2% cap is reserved on entry; an empty pot gives a TWAK-only spin. `receive()` stays payable for Launch/Router. Owner (timelock) can only pause new entries; there is **no withdraw** of TWAK or BNB.
- **Seed:** intended = the 7% allocation (`PRIZE_ALLOCATION` 70M via `TokenBound`). **Testnet:** the skeleton DrawV2 `0x5B3028454a628F73A5fe9198DE4fddefCC43c73A` keeps the 70M (no withdraw) and stays `TowackLaunch.drawV2Treasury` (immutable), so sellout BNB still lands there. The new pool is a stand-alone deploy (`presetToken_`) seeded with a **5,000,000 TWAK testnet stand-in** from the ecosystem/deployer wallet until a future full stack redeploy.
- **Constructor change:** `DrawV2(owner, presetToken, vrfConfig)`. `address(0)` = bind later via `bindToken` (70M check). Fixture, `DeployTestnet.s.sol` and the fork test were updated.
- **Tests:** `forge test`: **112 passed, 0 failed, 1 skipped** (89 → −5 old raffle tests + 28 new in `test/DrawV2.t.sol`; skipped = gated fork test). `FOUNDRY_FUZZ_RUNS=2000` on `testFuzz_RandomFlowSolvent` + `testFuzz_PrizeForWordMatchesCumTable`: **passed**. Handler invariants (solvent, conserved, bounded by booked maxes; 256 runs × 500 calls, 0 reverts): **passed**. VRF callback measures ~143k gas cold (limit 300k).
- **Deployed in the same broadcast:** new pool [`0x66E84a08f770a137a0F1263881d0E12279450191`](https://testnet.bscscan.com/address/0x66E84a08f770a137a0F1263881d0E12279450191) (create [tx](https://testnet.bscscan.com/tx/0x0b740748f907fde2970be3176e9741618e17f77cab6e4732930b0c9bf9ccb05d)), owner = timelock, seeded 5M, `availableTwak` = 5M. Sourcify **exact_match** (creation + runtime): [DrawV2](https://repo.sourcify.dev/contracts/full_match/97/0x66E84a08f770a137a0F1263881d0E12279450191/). Launch/Router still point at the skeleton treasury `0x5B30…c73A`.
- **Frontend:** `/lottery` rebuilt as the pool wheel: free pool, BNB pot, min/max entry, a 95% expected-return card, the payout table (scales with the typed entry), enter (exact approve) + spin landing on the on-chain prizeId, result card vs. entry, claim, retry, share. `SpinWheel` is reused with a new `lib/poolPrizes.ts` table; the paid and Genesis tables are untouched. `?demo=pool` uses the same gate as the other demos. `addresses.json` 97.drawV2 is the new pool; 97.drawV2Legacy is the skeleton. Launch/Router config is unchanged.
- **Web checks:** lint clean, `NEXT_PUBLIC_DEMO_WHEEL=1 npm run build` green, `:3126` restarted. Audit `--genesis` (4 viewports; now also `/lottery` and `/lottery?demo=pool`): **0 flags on every `/lottery` and `/mint` route**, scrollWidth = viewport. Home flags are the known hero false positives. Best: `web/shots/responsive/after-best/{phone,desktop}-lottery-v2.png`.

## Testnet e2e rehearsal (2026-11-22, 17:43–17:49 PKT)
Real txs on BSC testnet 97 from the deployer, `--legacy --with-gas-price 1gwei --slow`. Mateen’s 0.1 tBNB arrived (balance **0.172487133** tBNB before, vs ~0.0776 earlier today). No second wallet. All 9 txs `status=0x1`. Record: `deployments/bsc-testnet.json` → `e2eRehearsal`. Script: `script/E2ERehearsal.s.sol`.

- **Paid V1** `TowackLaunch.mint()` 0.1 tBNB: +80,000 TWAK, prizeId **8 (1.25×, +20,000 TWAK bonus)**, claimed. [mint](https://testnet.bscscan.com/tx/0x0763398fc30d2cb3625bc7dc832fecfcf88e7cb94801d8a3a7c6b72bd7fa86be) · [fulfillPseudo](https://testnet.bscscan.com/tx/0x771353a8cc3a05a15ef951a1b1c7ea6f528ebf8b1b3f03ae1ff88d4a2e659a4e) · [claim](https://testnet.bscscan.com/tx/0xc11c209be4f675c0a43eabf43140962b2208dfeb9348793a7c93b284272c1509)
- **Genesis 300** `mint(1)`: +20,000 TWAK base, prizeId **5 (1.1×, +2,000 extra)**, claimed. mintCount 1. [mint](https://testnet.bscscan.com/tx/0x99743d6a14a22fc76f4aac7ca1c65ba5854fd3224e87a5cd403c555d485eeec0) · [fulfillPseudo](https://testnet.bscscan.com/tx/0x49972ab6bd4072dff857e9fe617c54b324399676390d459c2a0fb7df97f70e20) · [claim](https://testnet.bscscan.com/tx/0xeae633b7bd2ad52c61fe5cb90448b9f982f7cd68ade79a858eb7836d993be20e)
- **DrawV2** `enter(1000 TWAK)`: prizeId **0 (0×)**, payout 0, entry stays in the pool (`availableTwak` 5,001,000). No claim tx. [approve](https://testnet.bscscan.com/tx/0xd7725a76a382a185cb6a11857c4e33d27778b16839ac48d90c9fec1a7bee811f) · [enter](https://testnet.bscscan.com/tx/0xd8c9ca3ae283ee668d2673a28b074553c00e43395f37d1bc8b0c125b994c7c51) · [fulfillPseudo](https://testnet.bscscan.com/tx/0x361a11e20df18473debd2624007122567c374a1a2960dcfa5242657577fe9cc2)
- **Balances:** TWAK 117,000,000 → **117,121,000** (+121,000). tBNB 0.172487133 → **0.071230003** (0.1 mint + ~0.00126 gas).
- **UI:** local production build with the same `addresses.json` as the preview (preview is SSO-gated). `/mint` shows Genesis **1 / 300** and paid **1 / 5,000**; `/lottery` shows free pool **5,001,000 TWAK**, **1 spin so far**. Shots: `web/shots/e2e/phone-mint-after-e2e.png`, `phone-lottery-after-e2e.png`. No contract bugs found.

## Draw V1 rewrite: per-mint prize wheel (redeployed 2026-11-22, 04:01:27 PKT)
Second BSC testnet deploy of the rewritten `TowackLaunch`. Frontend + docs landed in `21ea5b0`. This commit wires `web/src/config/addresses.json` and `deployments/bsc-testnet.json` to the new addresses. No mainnet deploy. The first single-seed deploy (03:11 AM PKT, launch `0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494`) is superseded and should not be minted into.

- **New model.** Every `mint()` requests its own Chainlink VRF v2.5 word. The callback pops one slot uniformly from a fixed, immutable 5,000-slot deck (`word % remainingTotal`, walk 11 packed counts, O(11)) and emits `PrizeAssigned(address indexed minter, uint256 indexed mintIndex, uint8 prizeId, uint256 bnbWei, uint256 bonusTokens)`. Prizes are mutually exclusive: 500/600/800/1,600 refunds (100/75/50/25%), 20/40/80/160/320/400 bonuses (5×…1.1×), and 480 no-win.
- **New / changed functions:** `mint()` (now also requests VRF), `retryPrize(address)` (replaces `retryDraw`, per-minter, 1h delay), `claim()` (available as soon as the prize is assigned), `closeMint()` (no VRF request any more), `finalizeListing()` (replaces `finalizeDraw`; requires no pending VRF), `sweepUnclaimed()`. Views: `prizeOf(address) → (minted, assigned, prizeId, bnb, bonus, claimed)`, `tickets`, `requestMinter`, `remaining(id)`, `remainingCounts()`, `remainingTotal`, `pendingCount()`, `assignedCount`, `bnbAssigned/bonusAssigned/bnbOutstanding/bonusOutstanding`, `bonusBurned`, `prizeSlots/prizeBnb/prizeBonus(id)`. Removed: `seed`, `vrfRequestId`, `vrfRequestedAt`, `bnbTier*`/`bonusTier*` helpers, the SwapOrNot-based `prizeOf(index)`. Events: `PrizeRequested`, `PrizeAssigned`, `ListingFinalized` (replaces `DrawFinalized`). Phases: `Minting, Closed, Finalized`.
- **Listing:** at sellout, 175 BNB stays reserved for prizes until claimed, LP gets 250 BNB + 200M TWAK, 75 BNB goes to DrawV2, and 14.8M bonus is burned. If undersold, undrawn deck slots are unsold: their BNB goes to LP/DrawV2 and their bonus is burned. The listing price is always the mint price.
- **VRF callbackGasLimit:** 300k in the deploy script and fixtures (measured ~58k cold, worst-case walk).
- **Tests (forge 1.10.0):** `forge test`: **68 passed, 0 failed, 1 skipped** (fork test, gated). `FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz`: **6/6 passed**, including the new `testFuzz_DeckInvariants` (K ≤ 5000 draws: assigned + remaining = initial per tier, sum = remainingTotal, ids in 0..10, ≤175 BNB / ≤35.2M) and `testFuzz_SolvencyFlow` (mint → VRF → early claims → close → finalize → claims; contract ends empty). `BSC_FORK=1` fork test against real Pancake v2 testnet: **passed**.
- **Frontend:** `motion` added. New carnival `SpinWheel` (odds-sized slices with a 13° minimum, legend shows true odds, deterministic landing from the on-chain prizeId), confetti (bigger for full refund / 5× / 3×), claim + Share on X, VRF retry button, and a live `PrizeAssigned` feed. `/draw` is now the prize booth (wheel, feed, status, deck legend with live remaining counts). Site-wide motion covers the hero entrance, scroll reveals, the animated mint counter and progress bar, growing tokenomics stacks and bonus bars, and hover micro-interactions. `prefers-reduced-motion` stops the loops, snaps the wheel to the prize, and turns off confetti. `npm run build` **green**, `npm run lint` clean. ABIs re-exported.

## Responsive layout (completed 2026-11-22, 05:31 AM PKT)
Resumed after the 5:00 AM PKT Claude Code reset. Foundry untouched. Lint + `NEXT_PUBLIC_DEMO_WHEEL=1` build green.

**Before (04:18–04:23 AM PKT):** 1,257 flags. Real bugs fixed in `48b7ed5`: 12-col `gap-8` page overflow; no hamburger / clipped nav; hero art overlapping CTAs at 1024; clipped “80K TWAK”; tokenomics `min-w-[720px]` empty chart; wheel needle clipped by `overflow-hidden`; small tap targets; docs CTA overlap.

**This morning (`48b7ed5` + follow-up):** re-audited all 11 viewports into `web/shots/responsive/after/`. Remaining real bugs then fixed:
- `PrizeTables` `BonusBars` overflowed 13.6px on 360px (page `scrollWidth` 374, labels clipped to “1.1” / “+8,0”). Now a 3×2 grid on phones and 6 columns from `sm`, with `min-w-0` and `whitespace-nowrap`. android-sm home is **360px** wide; every label is visible.
- Bars used `scaleY: 0` + `amount: 0.4`, so IntersectionObserver never fired and the coloured bars stayed hidden. Same rule as `CoinColumn`: initial `scaleY: 0.85`, `amount: 0.2`. Bars are visible on first paint.
- `AddressLink` in `status.tsx` is `inline-flex min-h-10 items-center` (40px tall).

**After audit (05:28:52 PKT):** 269 flags, **0** `horizontal-overflow`, **0** `tap-target-small`, **0** PrizeTables hits. Leftovers are false positives (hero sunburst SVG inside an `overflow-hidden` stage, hero-stage `text-clipped`, mint-demo confetti `span.absolute`). One flaky `demo-land-timeout` on mac-1280 only; phone landed shots are good. Open polish: in the fixed-height column, mid/tall bonus bars get squashed to similar heights.

**Final after-best shots** (untracked) under `web/shots/responsive/after-best/`:
- Phone: `phone-home-nav-hero.png`, `phone-nav-open.png`, `phone-mint-wheel-landed.png` + `-crop.png`, `phone-bonus-bars.png`
- iPad landscape: `ipad-home-fold.png`
- Mac 1280: `mac-home-fold.png`, `mac-bonus-bars.png`

New preview (not production, SSO on): https://towack-235s5xz7h-abcd-532d.vercel.app

## Next steps (product)
1. **Needs Mateen:** a full token-stack redeploy if paid V1 (`TowackLaunch`) should also use official Chainlink VRF. The live Launch is ownerless with immutable VRF config and holds 650M TWAK plus one claimed paid mint.
2. Cut a new Vercel preview (not production) so the UI points at official-VRF Genesis/DrawV2. The current preview still has the old mock-VRF addresses.
3. More tBNB to `0x38A0f77Dad60B34cF5cD39305687e354696a6776` for a real 0.1 paid mint (current balance **0.020915098** tBNB). Until the full redeploy, that mint would still use MockVRF `fulfillPseudo`.
4. Optional: BscScan verification once a paid API plan covers chain 97. Genesis + DrawV2 (official VRF) are already Sourcify **exact_match**.

## Vercel preview (2026-11-22, 06:50:24 PKT)
Preview only (not production), project `abcd-532d/towack`, Node 24.x, framework Next.js. Deployment protection remains `vercel_authentication`.
- Preview: https://towack-czg2h9vg8-abcd-532d.vercel.app
- Inspector: https://vercel.com/abcd-532d/towack/BHVvt7wH47tmH3kcTeZkCR6XRqbk
- Deployment id: `dpl_BHVvt7wH47tmH3kcTeZkCR6XRqbk`, target `None`.
- `NEXT_PUBLIC_DEMO_WHEEL=1` is set on the **Preview** environment only (not Production), so `?demo=wheel`, `?demo=genesis` and `?demo=pool` work on this preview.
- Previous previews: https://towack-235s5xz7h-abcd-532d.vercel.app (responsive layout), https://towack-bmrfdbzop-abcd-532d.vercel.app (pre-layout-fix), https://towack-788t1xqg4-abcd-532d.vercel.app (old addresses).

## Wheel screenshots (1280×800, 2026-11-22, ~04:09 AM PKT)
Taken against a local `next dev` with `NEXT_PUBLIC_DEMO_WHEEL=1` and `?demo=wheel` (first demo prize is 3× TWAK). Not committed.
- Mid-spin: `/tmp/towack-wheel-shots/wheel-midspin.png` (also `web/shots/wheel-midspin.png`)
- Landed (needle on 3×, result card in the full-page shot): `/tmp/towack-wheel-shots/wheel-landed.png` and `wheel-landed-full.png`
- Home hero: `/tmp/towack-wheel-shots/home.png` (also `web/shots/home-wheel.png`)

## BSC testnet deploy #2 (22 Nov 2026, 04:01:27 PKT) — current
Broadcast of `script/DeployTestnet.s.sol` on chain 97 with `--legacy --with-gas-price 1gwei --slow --start-fresh` (nonce 16). Estimated 0.014852261 tBNB; deployer started at 0.089094202 tBNB. Full record: `deployments/bsc-testnet.json`. Explorer: https://testnet.bscscan.com

Default MockAgentId + MockVRFCoordinator (testnet only; VRF is owner-fulfilled, not Chainlink). `callbackGasLimit` 300,000. Mint window: **22 Nov 2026, 04:00:56 PKT** to **25 Nov 2026, 04:00:56 PKT** (3 days). Team/dev/seasons/POL wallets defaulted to the deployer.

| Contract | Address | Create tx |
|---|---|---|
| MockAgentId | [`0xfF5f224349e6aDB7754249d5e4352dB0910717B7`](https://testnet.bscscan.com/address/0xfF5f224349e6aDB7754249d5e4352dB0910717B7) | [tx](https://testnet.bscscan.com/tx/0xb29d2413636d06489b757cb2cf1567b161f7548d7d3bcec774e719fc511aedb0) |
| MockVRFCoordinator | [`0x09d282Fc69840BcF4047b89F884738f041f53F61`](https://testnet.bscscan.com/address/0x09d282Fc69840BcF4047b89F884738f041f53F61) | [tx](https://testnet.bscscan.com/tx/0xf19ead76de9fdc984064f113d26fdb54e393cd1e0e9f00231609432128193794) |
| TimelockController | [`0x66F42673E3d31Dd90eE3fDEdb75012F0d02A1d0e`](https://testnet.bscscan.com/address/0x66F42673E3d31Dd90eE3fDEdb75012F0d02A1d0e) | [tx](https://testnet.bscscan.com/tx/0x33980cd8f89a911c9f2e941c8b8da1cb88f4e752bca1687ceea7913733904624) |
| DrawV2 | [`0x5B3028454a628F73A5fe9198DE4fddefCC43c73A`](https://testnet.bscscan.com/address/0x5B3028454a628F73A5fe9198DE4fddefCC43c73A) | [tx](https://testnet.bscscan.com/tx/0xaf91930acd92bf3cb04a1d7bf3e03151e449c5034267ae4ec5fba986011b1aac) |
| TowackLaunch | [`0x37720d1a42E483fB36d09bc93596a2feF535FF8b`](https://testnet.bscscan.com/address/0x37720d1a42E483fB36d09bc93596a2feF535FF8b) | [tx](https://testnet.bscscan.com/tx/0x76ab504c40448a6f80d837a6246279225015b12c9a9415630df1b917b14f1383) |
| RebateDistributor | [`0x26a71aEFD06290212d86130a4775dD1e98A84BA0`](https://testnet.bscscan.com/address/0x26a71aEFD06290212d86130a4775dD1e98A84BA0) | [tx](https://testnet.bscscan.com/tx/0xfbc2f6b143be505a3f7c52a213c47e97afaba82d1485a712242e895df85d5852) |
| TeamVesting | [`0x1680f43c8d44A4357D874d85F80F4EA582ea255a`](https://testnet.bscscan.com/address/0x1680f43c8d44A4357D874d85F80F4EA582ea255a) | [tx](https://testnet.bscscan.com/tx/0x000d4bb117c0727f184dac020dc87e914d42bef929ef5d90d9b4df62cf5252c2) |
| TowackToken (TWAK) | [`0xD2A3eDD943d442af41e61c699F77e7E63ACff7dD`](https://testnet.bscscan.com/address/0xD2A3eDD943d442af41e61c699F77e7E63ACff7dD) | [tx](https://testnet.bscscan.com/tx/0xcfe531d28c4e6361f2860985396d536c1a614569f49c02c950803bc2726da30f) |
| TWAK/WBNB pair | [`0x0c3F0F2373cEB20f813EBf7B30931177c6F5F6b9`](https://testnet.bscscan.com/address/0x0c3F0F2373cEB20f813EBf7B30931177c6F5F6b9) | created with the token |
| TowackRouter | [`0x46dafE460EEdb1FedEE844A56BF364c20252AA7d`](https://testnet.bscscan.com/address/0x46dafE460EEdb1FedEE844A56BF364c20252AA7d) | [tx](https://testnet.bscscan.com/tx/0xf6a2d5b6dacd48d9ab9977f8ea205429c6ceacd3eb6f75d40cecad8db17d95cb) |

On-chain checks after deploy: token name/symbol Towack/TWAK, supply 1B, launch holds 650M, `mintCount = 0`, `phase = 0` (Minting), `remainingTotal = 5000`, prize id 0 has 500 slots and id 10 has 480. Bind txs all succeeded.

Smoke tests (MockAgentId):
- `registerFor` deployer — [tx](https://testnet.bscscan.com/tx/0x9ed2db7da61dc3c22edf10742e7b5b3cc1fc28c194c2102f792d707da1c83715)
- `balanceOf(deployer) = 1`, `totalSupply = 1`. A 0.1 tBNB mint was **not** sent (remaining deployer balance ~0.077620871 tBNB).

Verification: all nine contracts are a Sourcify **exact_match** (creation + runtime), verified around 04:03–04:05 AM PKT. BscScan/Etherscan verification was not submitted — free Etherscan API does not cover BSC testnet.

## Previous BSC testnet deploy (22 Nov 2026, ~3:11 AM PKT) — superseded
The first broadcast of `script/DeployTestnet.s.sol` (single-seed TowackLaunch). Addresses below are historical only. Explorer: https://testnet.bscscan.com

First broadcast attempt used a 1-wei EIP-1559 fee and stalled; it was replaced by a 1 gwei self-send (`0x4a483ef646131e4c7f7bba876469cf770a18c16fee0441b41e952936a7d741c7`) and the script was re-broadcast `--legacy --with-gas-price 1gwei --start-fresh`. Default MockAgentId + MockVRFCoordinator (testnet only; VRF is owner-fulfilled, not Chainlink). Mint window: 3 days from deploy.

| Contract | Address | Create tx |
|---|---|---|
| MockAgentId | [`0xdf4499f5690474F502a774eCF6B93E73f57944C8`](https://testnet.bscscan.com/address/0xdf4499f5690474F502a774eCF6B93E73f57944C8) | [tx](https://testnet.bscscan.com/tx/0xdbec1060de82dd507c7bdab6041794a6e5b2620e361f7ee66c3c0c352080d467) |
| MockVRFCoordinator | [`0xc102c1d5F308722d24850bb5ebF7214831D63E51`](https://testnet.bscscan.com/address/0xc102c1d5F308722d24850bb5ebF7214831D63E51) | [tx](https://testnet.bscscan.com/tx/0x15c0629f81f446cb9509b0bb9a6d90b41ca1f6a1a4f2a08ef46a6389d1a04045) |
| TimelockController | [`0x886e955A7B1f5027d029d2a47Dcd43ad6a1b73cf`](https://testnet.bscscan.com/address/0x886e955A7B1f5027d029d2a47Dcd43ad6a1b73cf) | [tx](https://testnet.bscscan.com/tx/0x779726f1548fc58de6d848621e656126299cbc2186f39cdce1e377b5d3c22436) |
| DrawV2 | [`0x9d2a285d244689221cB49a60ed8C738A4219cEF3`](https://testnet.bscscan.com/address/0x9d2a285d244689221cB49a60ed8C738A4219cEF3) | [tx](https://testnet.bscscan.com/tx/0x9eadd10dcbf6238eb994c64954504b1ead7b4540b91b4b9830f2e7ade04d7064) |
| TowackLaunch | [`0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494`](https://testnet.bscscan.com/address/0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494) | [tx](https://testnet.bscscan.com/tx/0x6bd3411662c42c1325fd254b002055d97f03a5a618079ef6806d509892a44987) |
| RebateDistributor | [`0x5771aE8dfD0E0B3Df86dDCB98190C9a2510926d3`](https://testnet.bscscan.com/address/0x5771aE8dfD0E0B3Df86dDCB98190C9a2510926d3) | [tx](https://testnet.bscscan.com/tx/0x0645efb239aefb73f63f6da2f6d28ad5c75533401d752c1367cbe9b9dd24673c) |
| TeamVesting | [`0xdB96E5518FA3D33DCB0b388299d5d1CeE12a2bB7`](https://testnet.bscscan.com/address/0xdB96E5518FA3D33DCB0b388299d5d1CeE12a2bB7) | [tx](https://testnet.bscscan.com/tx/0xdf20ad509469e66dbd1b491da209ac074b9f53dcbabb709aff8075a498b0b4d3) |
| TowackToken (TWAK) | [`0x13F3DC766Ea5cAB8A0727d697E6EBea9DA8Ecb28`](https://testnet.bscscan.com/address/0x13F3DC766Ea5cAB8A0727d697E6EBea9DA8Ecb28) | [tx](https://testnet.bscscan.com/tx/0xb9864c3f561e785e6e607bbc6d0f7f69d7b593f8c017330a8d64b90a1dda524c) |
| TWAK/WBNB pair | [`0xD8488539FAD6eb04C9EbBa0c07995E89701943F4`](https://testnet.bscscan.com/address/0xD8488539FAD6eb04C9EbBa0c07995E89701943F4) | created with the token |
| TowackRouter | [`0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038`](https://testnet.bscscan.com/address/0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038) | [tx](https://testnet.bscscan.com/tx/0xd42ef1231e7dfb8cf1b3bd79026d7e8dd9ab8b1619cf40b4998c213102b346d3) |

On-chain checks after deploy: token name/symbol Towack/TWAK, supply 1B, launch holds 650M, `mintCount = 0`, mint window open. Bind txs all succeeded.

Smoke tests (MockAgentId):
- `registerFor` test wallet `0x16879006122E93936Abb17801f619F8dBEca7f37` — [tx](https://testnet.bscscan.com/tx/0x6fbfd15dca87192453f06eaeb43267c04134abbe353df468473f09f6b8182640)
- `registerFor` deployer — [tx](https://testnet.bscscan.com/tx/0x3463c784f247d36d6803f6c5e06b2b7dca1e6ef99ae2ae13ee40aa904719079f)
- `balanceOf` both = 1, `totalSupply` = 2. A 0.1 tBNB mint was **not** sent (remaining deployer balance ~0.089 tBNB).

Verification: all nine contracts are a Sourcify **exact_match** (creation + runtime). BscScan/Etherscan verification was not submitted successfully — free Etherscan API does not cover BSC testnet.

## Frontend (web/) — 2026-11-22
Design: Arcade Sky (mockup variant C). Next.js 16 App Router, TypeScript strict, Tailwind v4, wagmi 2 + viem + RainbowKit 2.
- Routes: `/` home, `/mint`, `/draw`, `/trade`, `/rebates`, `/tokenomics` (incl. TeamVesting), `/lottery` (Draw V2 instant pool wheel), `/docs` (FAQ + risk).
- `npm run build`: **green** (all 9 routes static). `npm run lint`: clean. Smoke-tested in headless Chrome at 1280 and 768 px, no console errors.
- Wallets: injected always; Binance Wallet + WalletConnect when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set. Without it, Binance Wallet still works as an injected provider (extension / Binance app browser).
- Addresses: `web/src/config/addresses.json`. Chain 97 Towack addresses are filled with the **second** testnet deploy (prize-wheel Launch). Mainnet Towack addresses remain empty (official mainnet Agent ID is prefilled). After the address update, `?demo=wheel` is off unless `NEXT_PUBLIC_DEMO_WHEEL=1`.
- ABIs: `web/src/abi/` exported from `out/` by `web/scripts/export-abi.mjs` (`npm run abi`).
- Safety: every write goes through the user's wallet (wagmi `writeContract`); there's no server wallet, no keys, and no auto-sign. Approvals are exact amounts only (sell / pool-wheel enter). `maxUint256` is used only as the router's UNLIMITED *daily-limit* value, never as an approval.
- Build note: wagmi's Coinbase connector pulls optional `@x402/*` deps; they are aliased to stubs in `web/next.config.ts`.
- CI: the Foundry workflow is unchanged; no npm job was added.

## Contracts (src/)
| Contract | Purpose |
|---|---|
| `TowackToken` | ERC-20, 1B fixed supply minted to allocation recipients in the constructor. No tax, no owner. One-way pre-listing pair guard (see docs). |
| `TowackLaunch` | Mint (0.1 BNB → 80k TWAK, 1 per Agent ID, cap 5000). One VRF v2.5 request per mint; the callback pops one prize from a fixed 5,000-slot deck (mutually exclusive). Close burns unsold tokens. Pull claims. Lists on Pancake v2 at the mint price with LP burned to `address(0)`. Leftover BNB goes to DrawV2. 180-day claim window, then a sweep. **No owner.** |
| `TowackRouter` | Agent ID-gated buy/sell via Pancake v2. 1% BNB-leg fee split 50/30/20 (rebates / DrawV2 / dev). Exact approvals only. Leash daily limits: decreases immediate, raises after 24h. Records volume and fees. **No owner.** |
| `RebateDistributor` | 100M TWAK over 104 weekly epochs, pro-rata to router fees paid, plus the 50% BNB fee boost. Empty epochs roll over. On-chain claims. |
| `TeamVesting` | 50M TWAK. Start = deploy. 1-year cliff (nothing unlocks at the cliff), then linear daily over 4 years. |
| `DrawV2` | Instant pool wheel: TWAK goes into the pool, one VRF spin per entry pays 0×–10× of the entry (95% expected return), with a BNB bonus on 5×/10× (1%/2% of the free pot). Min 100 TWAK, 10× win ≤ 5% of the free pool. Pending spins reserve 10×. Owner (timelock) can only pause entries; no withdraw. |
| `VRFConsumerV25`, `TokenBound`, `libraries/SwapOrNot` | Shared bases. SwapOrNot is no longer used by TowackLaunch (kept with its tests). |
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
**Redeployed on BSC testnet (chain 97)** at 04:01:27 PKT on 22 Nov 2026 (prize-wheel Launch). Official Chainlink VRF v2.5 was wired for Genesis + DrawV2 at 18:30 PKT the same day (see the section at the top and `deployments/bsc-testnet.json` → `officialVrf`). The deployer key remains at `/workspace/secrets/towack-deployer.env` (mode 0600, never committed). Remaining balance is **0.020915098 tBNB** — not enough for a 0.1 mint. Paid Launch still uses MockVRFCoordinator.


## Known gaps / decisions to confirm
- **Pair guard** makes the token slightly non-standard before listing: transfers *to the pair* are blocked until listing. This is needed to stop pool pre-seeding. Everything else is plain ERC-20.
- The **bind step** (deployer, set-once) exists because the token mints to contracts that must exist first. After binding, the deployer has no powers.
- **Leash** limits are keyed by holder address, on the assumption that Agent IDs are soulbound (1 address = 1 ID). Default is unlimited; users opt in.
- **Rebates**: epoch 0 starts at deploy. Pre-listing epochs roll into the first epoch with trades. Wash trading costs 1% per leg, but if the TWAK budget is worth more than about 50% of the fees, washing can be profitable. Consider capping per-epoch emissions relative to fees.
- **DrawV2** pool wheel: prizes never claimed stay owed forever (they still count against availability). On testnet the 70M stays locked in the old skeleton (no withdraw) and Launch's BNB still goes there; the new pool runs on a 5M seed. The pool shrinks if players win more than the 5% edge recovers — by design it cannot go insolvent, but max entry shrinks with it. `retrySpin` has the same re-roll caveat as `retryPrize`.
- Seasons/referrals, ecosystem and POL buffer are plain recipient wallets. Use multisigs on mainnet.
- No external audit. `retryPrize` (1h without an answer) lets anyone re-request a single minter's VRF. Chainlink advises against re-requests (a still-pending fulfilment could be front-run with a retry = re-roll). This was accepted so one stuck request can't block `finalizeListing` forever.
- `finalizeListing` waits for **every** mint's VRF answer. If the VRF subscription runs dry, listing stalls until it is funded and `retryPrize` is called for the stuck minters. There is no owner override.
- Each mint now pays VRF fees (subscription or native). Budget ~5,000 requests for a sellout.
- The section "Test results (2026-11-22, forge 1.10.0)" below describes the old single-seed model; see the Draw V1 rewrite section above for current results.
- The mainnet deploy script is intentionally not written.

## Later
1. Paid-V1 close / finalize / router trades / rebate claim on the existing mock-VRF Launch (needs more tBNB for further 0.1 mints). Official-VRF Genesis mint + DrawV2 spin already rehearsed 18:32–18:33 PKT.
2. Plan the full stack redeploy that puts Launch on official VRF and seeds the pool with the real 70M. Review the rebate anti-wash parameters.
3. No mainnet deploy and no hackathon form submit until Mateen asks.
