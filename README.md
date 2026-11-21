# Towack (TWAK)

Agent ID-gated mint, lucky draw, and trading router on BNB Chain.

This repository is a work in progress for the Binance Wallet × BNB Chain Agent ID Hackathon. Contracts are being developed and tested on **BSC testnet only**. No mainnet deploy.

Ticker: **TWAK**. The name Towack is not an existing crypto token (a 2020 music event used a similar name; this project is unrelated).

## Layout
- `src/TowackToken.sol`: fixed 1B supply ERC-20, no tax
- `src/TowackLaunch.sol`: 0.1 BNB mint, Draw V1 (VRF v2.5 + swap-or-not shuffle), PancakeSwap listing
- `src/TowackRouter.sol`: Agent ID-gated swaps, 1% BNB-leg fee, Leash-style daily limits
- `src/RebateDistributor.sol`: fee-weighted weekly TWAK + BNB rebates
- `src/TeamVesting.sol`: 1-year cliff, then 4 years linear daily
- `src/DrawV2.sol`: ticket draw MVP (timelocked price input)
- `src/mocks/`: test/testnet mocks (Agent ID, VRF, Pancake)
- `script/DeployTestnet.s.sol`: BSC testnet deploy (chainid 97 only)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details and [STATUS.md](STATUS.md) for progress.

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
