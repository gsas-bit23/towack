# Mainnet go checklist

**MATEEN-ONLY — DO NOT RUN THE BROADCAST COMMAND UNTIL MATEEN SAYS GO.**

Towack protocol contracts have **not** been deployed to BSC mainnet (chain 56). This is the production-go runbook. Full verified-dependency probes: `deployments/bsc-mainnet.expected.json` (not a live deployment record). Script: `script/DeployFullStackMainnet.s.sol`.

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

2. **Fund the mainnet deployer** with at least **0.03 BNB** (`GAS_RESERVE` is enforced by the script). Expected spend is ~0.00155 BNB @ 0.1 gwei or ~0.0155 BNB @ 1 gwei. The deployer currently has **0 mainnet BNB**, so this fund step is required before go.

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
   - If `ECOSYSTEM_WALLET != MAINNET_DEPLOYER`: from `ECOSYSTEM_WALLET`, `TWAK.approve(genesis, 8000000e18)` then `TowackGenesis.fund(8000000e18)`; from `GENESIS_OWNER`, `TowackGenesis.open()`.
   - Verify all 8 deployed contracts on Sourcify (chain 56) and BscScan.
   - Record the live deploy in `deployments/bsc-mainnet.json`.
   - Copy addresses from `deployments/out/bsc-mainnet.addresses.json` into `web/src/config/addresses.json` (chain `"56"`) and `web/public/skills/towack/SKILL.md`.
   - Set `NEXT_PUBLIC_DEFAULT_CHAIN_ID=56` (and site URL / WalletConnect project id) in Vercel production env.
   - Promote to production only after Mateen's sign-off. Never run `vercel --prod` before that.

## Designed mainnet params

Paid Launch: 0.1 BNB, 80,000 TWAK, cap 5,000, Agent ID required, 5% referrer BNB (0.005) with one referrer per minter and no self-referral. Genesis: 300 free mints, 20,000 TWAK base + TWAK wheel, 8M budget, Agent ID required. DrawV2: open to everyone, 10,000-slot table, 95% expected return, min 100 TWAK, 70M pool. Router: anyone can trade; rebates are Agent ID only.
