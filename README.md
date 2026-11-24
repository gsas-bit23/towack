# Towack (TWAK)

Agent ID-gated mint, lucky draw, and an open trading router with Agent ID rebates on BNB Chain.

This repository is a work in progress for the Binance Wallet × BNB Chain Agent ID Hackathon. Contracts are live on **BSC mainnet** (chain 56; see [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json)) and also deployed on **BSC testnet**. The mainnet broadcast followed the explicit go in [docs/MAINNET_GO.md](docs/MAINNET_GO.md).

Ticker: **TWAK**. The name Towack is not an existing crypto token (a 2020 music event used a similar name; this project is unrelated).

Official X: [@towackxyz](https://x.com/towackxyz).

## Layout
- `src/TowackToken.sol`: fixed 1B supply ERC-20, no tax
- `src/TowackGenesis.sol`: Genesis 300 completely free claim (300 cap, flat 20,000 TWAK sent instantly, 6M TWAK budget, Agent ID token-id gate, non-payable: gas only, no VRF). Live mainnet Genesis: [`0x5B3028454a628F73A5fe9198DE4fddefCC43c73A`](https://bscscan.com/address/0x5B3028454a628F73A5fe9198DE4fddefCC43c73A#code) (Sourcify exact_match + BscScan verified). The older VRF Genesis `0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038` is retired (closed, surplus swept)
- `src/TowackLaunch.sol`: 0.1 BNB mint, Draw V1 prize wheel (one VRF v2.5 request per mint, fixed 5,000-slot deck, one prize per mint), PancakeSwap listing
- `src/TowackRouter.sol`: open `buy`/`sell` for any wallet, 1% BNB-leg fee, Leash-style daily limits; rebates accrue only to Agent ID wallets (a non-Agent trade's rebate share goes to the unattributed weekly boost)
- `src/RebateDistributor.sol`: fee-weighted weekly TWAK + BNB rebates
- `src/TeamVesting.sol`: 1-year cliff, then 4 years linear daily
- `src/DrawV2.sol`: instant pool wheel (TWAK into the pool, VRF multiplier 0×–10×, 95% expected return)
- `src/mocks/`: test/testnet mocks (Agent ID, VRF, Pancake)
- `script/DeployFullStackTestnet.s.sol`: BSC testnet full-stack deploy (chainid 97 only, Chainlink VRF v2.5 wrapper)
- `script/DeployFullStackMainnet.s.sol`: BSC mainnet full-stack deploy. Broadcast 23 Nov 2026, 7:17 PM PKT; record in [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json) (see [docs/MAINNET_GO.md](docs/MAINNET_GO.md)).
- `script/EstimateFullRedeploy.s.sol`: keyless deploy-cost estimate for 97 / 56 (refuses `--broadcast`)
- `script/RedeployGenesisFlatMainnet.s.sol`: BSC mainnet Genesis migration: close + sweep the old VRF Genesis, deploy the flat gas-only Genesis, fund 6M, open. `dryRun()` is keyless; broadcasting needs the owner's go (see [docs/MAINNET_GO.md](docs/MAINNET_GO.md))

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details and [STATUS.md](STATUS.md) for progress.

## Owner permissions (BSC mainnet)
No address can mint new TWAK, change fees or tax, pause trading, freeze tokens, or withdraw user funds or prize BNB. The privileged roles that do exist, read from the live contracts:

| Contract | Owner / admin | What it can do | What it cannot do |
|---|---|---|---|
| TowackToken `0xeC59…e494` | none | n/a | no mint function, no tax, no pause, no blacklist |
| TowackLaunch `0xc102…3E51` | none | n/a (`sweepUnclaimed` is permissionless and only moves expired, unclaimed prizes to DrawV2) | move mint proceeds, reserved prizes or LP anywhere else |
| TowackRouter `0x3e4a…C775` | none | n/a (each wallet sets only its own daily limit) | change the 1% fee or its 50/30/20 split |
| TeamVesting `0x9d2a…cEF3` | none | n/a | revoke or speed up vesting; the beneficiary is fixed |
| DrawV2 `0xdf44…44C8` | TimelockController `0x6E90…4D60` (2-day delay) | `setEntriesPaused`: pause or resume **new** entries | withdraw the TWAK or BNB pool, or touch assigned prizes |
| RebateDistributor `0x886e…73cf` | `routerAdmin` = TimelockController (2-day delay) | `setRouter` (repoint to a new router), `setRouterAdmin` (hand off, or `address(0)` to freeze) | move rebate funds to arbitrary addresses |
| TowackGenesis `0x5B30…c73A` | Towack ecosystem wallet `0x38A0…6776` (Ownable2Step; renounce disabled) | `open` / `close` the claim window; `sweepSurplus` sends TWAK not needed for remaining claims back to the ecosystem wallet | take back TWAK already claimed; each claim pays 20,000 TWAK in the same transaction |

Full addresses: [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json) and `web/src/config/addresses.json` (chain `"56"`).

## Frontend (web/)
Next.js App Router + wagmi/viem/RainbowKit + motion, "Atlas" product design (branch `design/atlas`). The prize wheel on /mint and /draw has a `?demo=wheel` preview when no live per-mint launch contract is configured. The production app is locked to BSC mainnet (56) with no network switch; live addresses are in `web/src/config/addresses.json` under `"56"` (the `"97"` section is historical and unused at runtime).
```sh
cd web && npm i && npm run dev        # http://localhost:3000
npm run build                         # production build
npm run abi                           # forge build + re-export ABIs to web/src/abi/
```
Contract addresses live in `web/src/config/addresses.json` (overridable via `NEXT_PUBLIC_TOWACK_<chain>_<KEY>`, see `web/.env.example`). If an address is missing, that page shows a neutral "Temporarily unavailable" state. Every Towack contract write opens in the user's own wallet; there is no server wallet. Exception: on `/perps`, a trade-only Aster API wallet the user sets up (`canWithdraw=false`) is stored in their browser and signs Aster requests without a per-order popup. See [web/README.md](web/README.md).

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
