# Towack (TWAK)

Agent ID-gated mint, lucky draw, and trading router on BNB Chain.

This repository is a work in progress for the Binance Wallet × BNB Chain Agent ID Hackathon. Contracts are being developed and tested on **BSC testnet only**. No mainnet deploy.

Ticker: **TWAK**. The name Towack is not an existing crypto token (a 2020 music event used a similar name; this project is unrelated).

## Layout
- `src/TowackToken.sol`: fixed 1B supply ERC-20, no tax
- `src/TowackLaunch.sol`: 0.1 BNB mint, Draw V1 prize wheel (one VRF v2.5 request per mint, fixed 5,000-slot deck, one prize per mint), PancakeSwap listing
- `src/TowackRouter.sol`: Agent ID-gated swaps, 1% BNB-leg fee, Leash-style daily limits
- `src/RebateDistributor.sol`: fee-weighted weekly TWAK + BNB rebates
- `src/TeamVesting.sol`: 1-year cliff, then 4 years linear daily
- `src/DrawV2.sol`: instant pool wheel (TWAK into the pool, VRF multiplier 0×–10×, 95% expected return)
- `src/mocks/`: test/testnet mocks (Agent ID, VRF, Pancake)
- `script/DeployTestnet.s.sol`: BSC testnet deploy (chainid 97 only)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details and [STATUS.md](STATUS.md) for progress.

## Frontend (web/)
Next.js App Router + wagmi/viem/RainbowKit + motion, "Arcade Sky" design, with a carnival spin wheel on /mint and /draw (`?demo=wheel` previews it when no live per-mint launch contract is configured). Default chain BSC testnet (97), mainnet (56) via the network toggle.
```sh
cd web && npm i && npm run dev        # http://localhost:3000
npm run build                         # production build
npm run abi                           # forge build + re-export ABIs to web/src/abi/
```
Contract addresses live in `web/src/config/addresses.json` (overridable via `NEXT_PUBLIC_TOWACK_<chain>_<KEY>`, see `web/.env.example`). Until they are filled, interactive pages show a "Contracts deploying soon" state. All writes are signed in the user's own wallet; the site holds no keys.

## Build & test
```sh
forge build
forge test -vv
FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz
BSC_FORK=1 forge test --match-contract ForkPancake -vv   # real Pancake v2 on a testnet fork
```

## Deploy (testnet)
```sh
set -a; source /workspace/secrets/towack-deployer.env; set +a   # PRIVATE_KEY, never committed
forge script script/DeployTestnet.s.sol --rpc-url bsc_testnet --broadcast
```
