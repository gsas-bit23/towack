# Mainnet go checklist

> **LIVE (23 Nov 2026, 7:17 PM PKT).** The stack was broadcast to BSC mainnet after Mateen's go. Record: [`deployments/bsc-mainnet.json`](../deployments/bsc-mainnet.json). Do **not** re-run `run()`; it would deploy a second stack. `GAS_RESERVE` is `0.002 ether`. Production Vercel promote and Sourcify/BscScan source verify are still pending Mateen's sign-off.

**Already broadcast — do not run `run()` again.** This runbook is kept for the record and for post-deploy steps (source verify, production promote). Dependency probes used before go: `deployments/bsc-mainnet.expected.json`. Script: `script/DeployFullStackMainnet.s.sol`. Live addresses: `deployments/bsc-mainnet.json`.

## Verified mainnet dependencies

Probed on-chain at block `135,163,386` via `https://bsc-rpc.publicnode.com` (22 Nov 2026, 23:00:44 UTC / 23 Nov 2026, 4:00:44 AM Asia/Karachi).

| Dependency | Address | Primary sources |
|---|---|---|
| SPACE ID Agent ID (`HandleRegistry`) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` | [Sourcify exact_match](https://repo.sourcify.dev/contracts/full_match/56/0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F/), [BscScan](https://bscscan.com/address/0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F). Soulbound ERC-721 (`SPACE ID Agent ID` / `AI`); `handleOf` / `ownerOfHandle` / `ownerOf` confirmed on holder `0x56a9813E93363fb5141bdDD332f9BBbdC955e2b8` (`delben96`). |
| Chainlink VRF v2.5 wrapper | `0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94` | [Chainlink BNB Chain Mainnet direct-funding docs](https://docs.chain.link/vrf/v2-5/supported-networks#bnb-chain-mainnet), on-chain `typeAndVersion() = VRFV2PlusWrapper 1.0.0`, `s_vrfCoordinator()` matches below. Same CREATE2 address as BSC testnet; verified independently on chain 56. |
| Chainlink VRF v2.5 coordinator | `0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9` | Wrapper `s_vrfCoordinator()`, min confirmations 3, max gas 2,500,000. |
| PancakeSwap v2 factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | [PancakeSwap v2 addresses](https://developer.pancakeswap.finance/contracts/v2/addresses) |
| PancakeSwap v2 router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | Same docs; `router.WETH()` = WBNB. |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | Same docs / `WETH()`. |

Towack chain-56 contract addresses stay empty until a real deploy. The app shows a launching-soon state until `web/src/config/addresses.json` `"56"` is populated.

## Fork dry-run cost (already run — do not treat as a live deploy)

Local Anvil `forkRun()` of the full stack: **15,521,207 gas** (16 txs, all succeeded). Deployer-only path is 13 txs / **15,329,466 gas** when `ECOSYSTEM_WALLET != deployer`.

| Gas price | Cost |
|---|---|
| 0.05 gwei | 0.000776060 BNB |
| 0.10 gwei | 0.001552121 BNB |
| 1.00 gwei | 0.015521207 BNB |

No VRF subscription deposit. Users pay VRF per request (quote + 10% buffer; excess refunded). Callback gas: Launch 165k, Genesis 170k, DrawV2 200k.

## Steps

1. **Prepare multisig / Safe wallets on BSC mainnet (chain 56)** for: `SEASONS_WALLET`, `ECOSYSTEM_WALLET`, `POL_BUFFER_WALLET`, `TEAM_BENEFICIARY`, `DEV_WALLET` (must accept plain BNB transfers), `TIMELOCK_PROPOSER`, and `GENESIS_OWNER` (or leave `GENESIS_OWNER` as a multisig / hand off via 2-step transfer to the Timelock after opening).

2. **Fund the mainnet deployer** with at least **0.002 BNB** (lowered from 0.03 per Mateen's go, 23 Nov 2026) (`GAS_RESERVE` is enforced by the script). Expected spend is ~0.00155 BNB @ 0.1 gwei or ~0.0155 BNB @ 1 gwei. The 23 Nov 2026 broadcast spent **0.0015521157 BNB** at 0.1 gwei (16 txs, 15,521,157 gas). The deployer had 0.00263475957 BNB before and **0.00108264387 BNB** after.

3. **Keyless pre-flight (safe, no broadcast, anyone can run):**

   ```bash
   forge script script/DeployFullStackMainnet.s.sol --sig "dryRun()" --rpc-url https://bsc-rpc.publicnode.com
   ```

4. **MATEEN-ONLY broadcast (DO NOT RUN UNTIL MATEEN SAYS GO):**

   ```bash
   set -a; source <mainnet-deployer-env>; set +a   # PRIVATE_KEY only; never echo or commit
   TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO \
   MAINNET_DEPLOYER=0x... \
   SEASONS_WALLET=0x... \
   ECOSYSTEM_WALLET=0x... \
   POL_BUFFER_WALLET=0x... \
   TEAM_BENEFICIARY=0x... \
   DEV_WALLET=0x... \
   TIMELOCK_PROPOSER=0x... \
   GENESIS_OWNER=0x... \
   forge script script/DeployFullStackMainnet.s.sol --sig "run()" \
     --rpc-url https://bsc-dataseed.bnbchain.org \
     --broadcast --slow --legacy --with-gas-price 0.1gwei
   ```

   Optional timing env: `MINT_START` (unix; default deploy-block timestamp), `MINT_DURATION` (default `604800` = 7 days), `TIMELOCK_DELAY` (default `172800` = 48h, min `86400` = 24h).

5. **Post-deploy (after a successful Mateen broadcast):**
   - If `ECOSYSTEM_WALLET != MAINNET_DEPLOYER`: from `ECOSYSTEM_WALLET`, `TWAK.approve(genesis, budget)` then `TowackGenesis.fund(budget)`; from `GENESIS_OWNER`, `TowackGenesis.open()`. (Budget was 8,000,000e18 for the original VRF Genesis; the current flat Genesis source uses 6,000,000e18.)
   - Verify all 8 deployed contracts on Sourcify (chain 56) and BscScan.
   - Record the live deploy in `deployments/bsc-mainnet.json`.
   - Copy addresses from `deployments/out/bsc-mainnet.addresses.json` into `web/src/config/addresses.json` (chain `"56"`) and `web/public/skills/towack/SKILL.md`.
   - Set `NEXT_PUBLIC_DEFAULT_CHAIN_ID=56` (and site URL / WalletConnect project id) in Vercel production env.
   - Promote to production only after Mateen's sign-off. Never run `vercel --prod` before that.

## Designed mainnet params

Paid Launch: 0.1 BNB, 80,000 TWAK, cap 5,000, Agent ID required, 5% referrer BNB (0.005) with one referrer per minter and no self-referral. Genesis (current source, flat migration pending broadcast): 300 completely free claims, flat 20,000 TWAK each sent instantly, non-payable (gas only, no VRF), 6M budget, Agent ID required. (The original 23 Nov 2026 deploy was 20,000 TWAK base + VRF TWAK wheel, 8M budget.) DrawV2: open to everyone, 10,000-slot table, 95% expected return, min 100 TWAK, 70M pool. Router: anyone can trade; rebates are Agent ID only.

## Genesis 300 flat migration (broadcast 2026-11-23 23:17 PKT)

The Genesis 300 source is a completely free, gas-only, flat 20,000 TWAK claim (non-payable `mint(uint256)` / `mintByHandle()`, no Chainlink VRF, no wheel, no second `claim()`, 6,000,000 TWAK budget).

**Live mainnet Genesis:** [`0x5B3028454a628F73A5fe9198DE4fddefCC43c73A`](https://bscscan.com/address/0x5B3028454a628F73A5fe9198DE4fddefCC43c73A#code) — Sourcify `exact_match` (creation + runtime) and BscScan/Etherscan verified.

**Retired VRF Genesis:** [`0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038`](https://bscscan.com/address/0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038) — closed, 7,938,000 unused TWAK swept to the deployer. Do not send new mints there.

Broadcast from deployer `0x38A0f77Dad60B34cF5cD39305687e354696a6776` after Mateen's go (`t228s1033` / `t229u`), via `script/RedeployGenesisFlatMainnet.s.sol` (close + sweep + deploy + approve + fund 6,000,000 TWAK + open). 6 txs, 1,273,767 gas, 0.0001273767 BNB at 0.1 gwei (legacy):

1. `close()` — [0x35d3f70e600d14309e749dfd8eb6b10886d8c1b2238eb55466d8818b4530ae57](https://bscscan.com/tx/0x35d3f70e600d14309e749dfd8eb6b10886d8c1b2238eb55466d8818b4530ae57)
2. `sweepSurplus()` — [0x9da53a5f0fcb597ec929436ce4bc1f939df5043c66a4cae876c73bad8a4d2436](https://bscscan.com/tx/0x9da53a5f0fcb597ec929436ce4bc1f939df5043c66a4cae876c73bad8a4d2436)
3. `CREATE TowackGenesis` — [0x6c4b753814dbb91fbbfdac88b4280dda17875c86cabed78df5105a6eeba83c48](https://bscscan.com/tx/0x6c4b753814dbb91fbbfdac88b4280dda17875c86cabed78df5105a6eeba83c48)
4. `TWAK.approve` — [0x32e83f5c0a8d8ddb689212869cd65c88268b91ff725882d7873b40db6f12277c](https://bscscan.com/tx/0x32e83f5c0a8d8ddb689212869cd65c88268b91ff725882d7873b40db6f12277c)
5. `fund(6,000,000e18)` — [0x8ab914875c1b3ebd6c98cf98d7c4bfaba8bf355cf73e741f330bd772c925b0f8](https://bscscan.com/tx/0x8ab914875c1b3ebd6c98cf98d7c4bfaba8bf355cf73e741f330bd772c925b0f8)
6. `open()` — [0x0a8897ff93e82dcb1c4dc65d446e94bfe591b02ade733cd2f870531d77478411](https://bscscan.com/tx/0x0a8897ff93e82dcb1c4dc65d446e94bfe591b02ade733cd2f870531d77478411)

On-chain checks: old `isOpen()==false`, surplus 0; new `isOpen()==true`, `balanceOf==committed()==6,000,000e18`. Frontend `addresses.json` chain 56 `genesis`, `SKILL.md`, and `deployments/bsc-mainnet.json` point at the new address.

