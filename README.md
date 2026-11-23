# Towack (TWAK)

Agent ID-gated mint, lucky draw, and an open trading router with Agent ID rebates on BNB Chain.

This repository is a work in progress for the Binance Wallet × BNB Chain Agent ID Hackathon. Contracts are live on **BSC mainnet** (chain 56; see [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json)) and also deployed on **BSC testnet**. The mainnet broadcast followed the explicit go in [docs/MAINNET_GO.md](docs/MAINNET_GO.md).

Ticker: **TWAK**. The name Towack is not an existing crypto token (a 2020 music event used a similar name; this project is unrelated).

## Layout
- `src/TowackToken.sol`: fixed 1B supply ERC-20, no tax
- `src/TowackGenesis.sol`: Genesis 300 free mint (300 cap, 20,000 TWAK base, 8M TWAK budget, Agent ID token-id gate, caller pays only the VRF fee)
- `src/TowackLaunch.sol`: 0.1 BNB mint, Draw V1 prize wheel (one VRF v2.5 request per mint, fixed 5,000-slot deck, one prize per mint), PancakeSwap listing
- `src/TowackRouter.sol`: open `buy`/`sell` for any wallet, 1% BNB-leg fee, Leash-style daily limits; rebates accrue only to Agent ID wallets (a non-Agent trade's rebate share goes to the unattributed weekly boost)
- `src/RebateDistributor.sol`: fee-weighted weekly TWAK + BNB rebates
- `src/TeamVesting.sol`: 1-year cliff, then 4 years linear daily
- `src/DrawV2.sol`: instant pool wheel (TWAK into the pool, VRF multiplier 0×–10×, 95% expected return)
- `src/mocks/`: test/testnet mocks (Agent ID, VRF, Pancake)
- `script/DeployFullStackTestnet.s.sol`: BSC testnet full-stack deploy (chainid 97 only, Chainlink VRF v2.5 wrapper)
- `script/DeployFullStackMainnet.s.sol`: BSC mainnet full-stack deploy. Broadcast 23 Nov 2026, 7:17 PM PKT; record in [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json) (see [docs/MAINNET_GO.md](docs/MAINNET_GO.md)).
- `script/EstimateFullRedeploy.s.sol`: keyless deploy-cost estimate for 97 / 56 (refuses `--broadcast`)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details and [STATUS.md](STATUS.md) for progress.

## Frontend (web/)
Next.js App Router + wagmi/viem/RainbowKit + motion, "Atlas" product design (branch `design/atlas`). The prize wheel on /mint and /draw has a `?demo=wheel` preview when no live per-mint launch contract is configured. Default chain BSC testnet (97), mainnet (56) via the network toggle; live mainnet addresses are in `web/src/config/addresses.json` under `"56"`.
```sh
cd web && npm i && npm run dev        # http://localhost:3000
npm run build                         # production build
npm run abi                           # forge build + re-export ABIs to web/src/abi/
```
Contract addresses live in `web/src/config/addresses.json` (overridable via `NEXT_PUBLIC_TOWACK_<chain>_<KEY>`, see `web/.env.example`). Until they are filled, interactive pages show a "Contracts deploying soon" state. Every Towack contract write opens in the user's own wallet; there is no server wallet. Exception: on `/perps`, a trade-only Aster API wallet the user sets up (`canWithdraw=false`) is stored in their browser and signs Aster requests without a per-order popup. See [web/README.md](web/README.md).

## Build & test
```sh
forge build
forge test -vv
FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz
BSC_FORK=1 forge test --match-contract ForkPancake -vv   # real Pancake v2 on a testnet fork
```

## Deploy (testnet only)
Mainnet is already live. Do not re-run the mainnet script; see [docs/MAINNET_GO.md](docs/MAINNET_GO.md) and [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json).
```sh
set -a; source /workspace/secrets/towack-deployer.env; set +a   # PRIVATE_KEY, never committed
forge script script/DeployFullStackTestnet.s.sol --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
```
