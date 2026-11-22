# Towack status

**Repo:** https://github.com/gsas-bit23/towack
**Milestone:** 1 — instant per-mint prize-wheel contracts redeployed on BSC testnet (97); Arcade Sky frontend wired to the new addresses.

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

A new Vercel preview URL is recorded in the Vercel section below once deployed (abcd-532d/towack, preview only, SSO on).

## Next steps (product)
1. Send more tBNB to `0x38A0f77Dad60B34cF5cD39305687e354696a6776` to run a real 0.1 tBNB mint (balance after the second deploy + MockAgentId registration is ~0.0776 tBNB). The deployer already holds a Mock Agent ID on the **new** mock (`0xfF5f224349e6aDB7754249d5e4352dB0910717B7`).
2. Optional: a BscScan-verified listing once a paid Etherscan/BscScan API plan covers chain 97. All nine new contracts are already a Sourcify **exact_match**.
3. End-to-end testnet rehearsal once funded: mint, owner-fulfil MockVRF, watch the wheel land, claim, then later close / finalize / router / rebates.

## Vercel preview (2026-11-22, 04:08:02 PKT)
Preview only (not production), project `abcd-532d/towack`, Node 24.x, framework Next.js. Deployment protection remains `vercel_authentication`.
- Preview: https://towack-bmrfdbzop-abcd-532d.vercel.app
- Inspector: https://vercel.com/abcd-532d/towack/9kL3SkNtL9ES8sKMbS2jJWadDFHy
- Deployment id: `dpl_9kL3SkNtL9ES8sKMbS2jJWadDFHy`, target `None`.
- Previous preview (old addresses): https://towack-788t1xqg4-abcd-532d.vercel.app
- `?demo=wheel` is off on this preview because a live per-mint launch is configured. Local demo screenshots used `NEXT_PUBLIC_DEMO_WHEEL=1`.

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
- Routes: `/` home, `/mint`, `/draw`, `/trade`, `/rebates`, `/tokenomics` (incl. TeamVesting), `/lottery` (Draw V2 MVP), `/docs` (FAQ + risk).
- `npm run build`: **green** (all 9 routes static). `npm run lint`: clean. Smoke-tested in headless Chrome at 1280 and 768 px, no console errors.
- Wallets: injected always; Binance Wallet + WalletConnect when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set. Without it, Binance Wallet still works as an injected provider (extension / Binance app browser).
- Addresses: `web/src/config/addresses.json`. Chain 97 Towack addresses are filled with the **second** testnet deploy (prize-wheel Launch). Mainnet Towack addresses remain empty (official mainnet Agent ID is prefilled). After the address update, `?demo=wheel` is off unless `NEXT_PUBLIC_DEMO_WHEEL=1`.
- ABIs: `web/src/abi/` exported from `out/` by `web/scripts/export-abi.mjs` (`npm run abi`).
- Safety: every write goes through the user's wallet (wagmi `writeContract`); there's no server wallet, no keys, and no auto-sign. Approvals are exact amounts only (sell / lottery enter). `maxUint256` is used only as the router's UNLIMITED *daily-limit* value, never as an approval.
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
| `DrawV2` | MVP weekly draw: burn TWAK for tickets at $1 = 1 ticket. The price input is a setter or price source behind a 48h `TimelockController`. VRF picks the winner. Prize = 700k TWAK + 20% of the free BNB pot. Owner cannot withdraw. |
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
**Redeployed on BSC testnet (chain 97)** at 04:01:27 PKT on 22 Nov 2026 (prize-wheel Launch). Addresses, txs, Sourcify links, and smoke-test hashes are in the section at the top of this file and in `deployments/bsc-testnet.json`. The deployer key remains at `/workspace/secrets/towack-deployer.env` (mode 0600, never committed). Remaining balance is ~0.0776 tBNB — not enough for a 0.1 mint. Default deploy used MockVRFCoordinator (testnet only). Official VRF v2.5 was not wired.


## Known gaps / decisions to confirm
- **Pair guard** makes the token slightly non-standard before listing: transfers *to the pair* are blocked until listing. This is needed to stop pool pre-seeding. Everything else is plain ERC-20.
- The **bind step** (deployer, set-once) exists because the token mints to contracts that must exist first. After binding, the deployer has no powers.
- **Leash** limits are keyed by holder address, on the assumption that Agent IDs are soulbound (1 address = 1 ID). Default is unlimited; users opt in.
- **Rebates**: epoch 0 starts at deploy. Pre-listing epochs roll into the first epoch with trades. Wash trading costs 1% per leg, but if the TWAK budget is worth more than about 50% of the fees, washing can be profitable. Consider capping per-epoch emissions relative to fees.
- **DrawV2** is an MVP: single winner per round, no TWAP oracle implementation yet (`ITwakPriceSource` interface only), and the 20% BNB-pot policy is a placeholder. Prizes a winner never claims stay owed forever.
- Seasons/referrals, ecosystem and POL buffer are plain recipient wallets. Use multisigs on mainnet.
- No external audit. `retryPrize` (1h without an answer) lets anyone re-request a single minter's VRF. Chainlink advises against re-requests (a still-pending fulfilment could be front-run with a retry = re-roll). This was accepted so one stuck request can't block `finalizeListing` forever.
- `finalizeListing` waits for **every** mint's VRF answer. If the VRF subscription runs dry, listing stalls until it is funded and `retryPrize` is called for the stuck minters. There is no owner override.
- Each mint now pays VRF fees (subscription or native). Budget ~5,000 requests for a sellout.
- The section "Test results (2026-11-22, forge 1.10.0)" below describes the old single-seed model; see the Draw V1 rewrite section above for current results.
- The mainnet deploy script is intentionally not written.

## Later
1. End-to-end testnet rehearsal on the new contracts: mint (needs more tBNB), VRF fulfil, claim, close, finalize, router trades, rebate claim.
2. Implement or choose a TWAP price source for DrawV2. Review the rebate anti-wash parameters.
3. No mainnet deploy and no hackathon form submit until Mateen asks.
