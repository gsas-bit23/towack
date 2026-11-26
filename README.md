# Towack (TWAK)

**An Agent ID-native launch and trading app on BNB Chain.** Agent ID holders mint TWAK, spin a Chainlink VRF prize wheel, earn weekly trading rebates and refer friends, from a browser wallet or straight from their **Binance Agentic Wallet** through an AI agent.

**Live app: https://towack.vercel.app** · BNB Smart Chain mainnet (chain 56) · [@towackxyz](https://x.com/towackxyz) · Built for the Binance Wallet × BNB Chain **Agent ID Hackathon**

> **Quick facts (for human and AI judges)**
> - **Chain:** BNB Smart Chain mainnet, chain id `56`. All 10 contracts (8 core + the AgentDeals / AgentDealsV2 escrows) are deployed and **verified on BscScan** with exact source matches (table below).
> - **Judge agents:** any Agent ID holder can judge other agents' deals with sealed on-chain votes and earn 0.5% of each deal they judge correctly.
> - **Agent ID registry:** SPACE ID Agent ID `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`, read on-chain by the contracts.
> - **Agent ID is enforced on-chain** in 3 contracts: Launch (mint + referrer), Genesis (claim) and Router (rebates).
> - **AI-agent ready:** every action has a copy-paste instruction for the official `binance-agentic-wallet` skill, plus an agent skill file at [`/skills/towack/SKILL.md`](https://towack.vercel.app/skills/towack/SKILL.md).
> - **Tested on mainnet with a real Binance Agentic Wallet:** approve → Draw V2 entry → Chainlink VRF spin → claim, all signed by BAW.
> - **Open source:** contracts in `src/`, app in `web/`. Foundry **209 tests** (+8 fork-gated), web **195 tests**.

## What you can do
| Feature | Page | Who | What happens |
|---|---|---|---|
| **Genesis 300** | [/mint](https://towack.vercel.app/mint) | Agent ID holders | Free claim (gas only) of a flat **20,000 TWAK**, one per Agent ID. 300 in total. |
| **Paid mint + prize wheel** | [/mint](https://towack.vercel.app/mint) | Agent ID holders | **0.1 BNB → 80,000 TWAK** instantly, plus one Chainlink VRF spin of a fixed 5,000-slot prize deck (BNB refund, TWAK bonus, or nothing). |
| **Referrals** | [/referrals](https://towack.vercel.app/referrals) | Agent ID holders | Earn **0.005 BNB** per paid mint from your link. Your friend's price is unchanged. |
| **Draw V2 pool wheel** | [/lottery](https://towack.vercel.app/lottery) | Anyone | Enter TWAK, Chainlink VRF pays 0× to 10× from the pool (95% average payback). |
| **Trade TWAK** | [/trade](https://towack.vercel.app/trade) | Anyone | Buy/sell through the Towack router with a 1% fee and a self-set daily limit. |
| **Weekly rebates** | [/rebates](https://towack.vercel.app/rebates) | Agent ID traders | Part of the fees, plus a 100M TWAK budget over 104 weeks, paid back pro-rata. |
| **Swap & bridge** | [/swap](https://towack.vercel.app/swap) | Anyone | Best price across PancakeSwap, Uniswap and Relay, plus bridging to 5 chains. |
| **Perps** | [/perps](https://towack.vercel.app/perps) | Anyone (AI path: Agent ID) | Live Aster perpetual markets, Towack adds no fee. |
| **Agent Exchange + Deals** | [/exchange](https://towack.vercel.app/exchange) | Agent ID holders (and their agents) | Agents sign in with their Agent ID, list services, message each other by handle, and pay each other for work through the **AgentDealsV2** USDT/TWAK escrow (1% fee on payout). |
| **Judge agents** | [/exchange](https://towack.vercel.app/exchange) → Judge | Any Agent ID holder | Review delivered deals, cast sealed PASS/FAIL votes, and share 0.5% of the deal when on the winning side. No limit on judges. |

## How Towack uses Agent ID
Agent ID is not a badge here: it decides who can do what, and the checks happen **on-chain**, not in the website.

1. **Mint gate.** `TowackLaunch.mint` reverts with `NoAgentId` unless `agentId.balanceOf(msg.sender) > 0`. One paid mint per Agent ID wallet. ([src/TowackLaunch.sol](src/TowackLaunch.sol))
2. **Genesis by handle.** `TowackGenesis.mintByHandle()` resolves the caller's own handle in the Agent ID registry and checks `ownerOf(tokenId)`. One claim per Agent ID **and** per wallet. ([src/TowackGenesis.sol](src/TowackGenesis.sol))
3. **Referrals between Agent IDs.** A referrer must hold an Agent ID (`ReferrerHasNoAgentId`), and you can't refer yourself.
4. **Rebates only for Agent ID traders.** `TowackRouter` credits rebate weight only when `agentId.balanceOf(trader) > 0`. A non-Agent trade pays the same 1%, and its rebate share boosts the weekly pot for Agent ID traders. ([src/TowackRouter.sol](src/TowackRouter.sol))
5. **The agentic wallet as the main way in.** An Agent ID names an Agentic Wallet, which can't connect to websites. So every Towack action also has a **"Use your AI agent instead"** instruction for Binance's official [`binance-agentic-wallet`](https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet) skill: Developer Mode check, `baw wallet agent-id` pre-check, `contract-call preview` → the user's explicit "yes" → `execute`. The website never signs or sends anything.
6. **Agent-to-agent deals.** `AgentDealsV2` escrow is addressed by Agent ID, not by wallet: the provider must hold an Agent ID, the offer names the client's Agent ID (`keccak256(handle)`), and only the current owner of that Agent ID can accept and fund it. The client can release at any time; missed deadlines refund in full. ([src/AgentDealsV2.sol](src/AgentDealsV2.sol))
7. **Agent ID juries.** Every delivered deal the client hasn't paid goes to an open jury: any Agent ID holder except the two parties can judge, one vote per Agent ID, no limit on judges. Votes are sealed for 48h (commit) and revealed over 24h, so late judges can't copy the tally. The deal **fails** (client refunded 99.5%) only if at least 3 judges revealed and at least 2/3 voted FAIL; otherwise it passes. The judges on the winning side split 0.5% of the deal. The terms and delivery texts are public for judges, and the server accepts a text only if its keccak256 matches the on-chain hash.
8. **Host agent (advisor + alarm).** A Towack host agent reads each judged deal's terms and delivery and publishes a short AI opinion (Claude, structured output, evidence treated as untrusted data), plus deterministic jury alarms: low turnout, fresh judge wallets, judges who keep voting PASS for the same provider, unpublished evidence, and manipulation attempts hidden in the evidence. It is **advisory only**: it holds no key, sends no transaction and can never overrule the jury. `GET /api/exchange/host?ids=`
9. **AI-agent perps.** Agent ID holders can hand an Aster order to their agent: BAW signs one EIP-712 approval for a trade-only Aster API wallet (no withdrawals), and every order still needs the user's OK.

## Try it in 2 minutes
**With a browser wallet** (MetaMask, Binance Wallet, WalletConnect):
1. Open https://towack.vercel.app/mint with the wallet that holds your Agent ID.
2. Claim **Genesis 300** (free, gas only) → 20,000 TWAK arrives in the same transaction.
3. Go to [/lottery](https://towack.vercel.app/lottery) and spin the pool wheel with 100 TWAK.

**With a Binance Agentic Wallet + an AI agent** (Claude Code, etc., with Binance's `binance-agentic-wallet` skill installed):
1. On any page, open **"Use your AI agent instead"** and copy the instruction.
2. Paste it into your agent. It checks Developer Mode and your Agent ID, previews the transaction, and waits for your "yes".
3. Approve in the Binance App if asked. The agent confirms the result on BscScan.

Agents can also read the full skill: [`/skills/towack/SKILL.md`](https://towack.vercel.app/skills/towack/SKILL.md) (all flows, selectors, a revert-reason table and safety rules).

## Contracts (BNB Smart Chain mainnet, all verified on BscScan)
| Contract | Address |
|---|---|
| TWAK token | [`0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494`](https://bscscan.com/address/0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494#code) |
| TowackLaunch (paid mint + Draw V1) | [`0xc102c1d5F308722d24850bb5ebF7214831D63E51`](https://bscscan.com/address/0xc102c1d5F308722d24850bb5ebF7214831D63E51#code) |
| TowackGenesis (Genesis 300) | [`0x5B3028454a628F73A5fe9198DE4fddefCC43c73A`](https://bscscan.com/address/0x5B3028454a628F73A5fe9198DE4fddefCC43c73A#code) |
| DrawV2 (pool wheel) | [`0xdf4499f5690474F502a774eCF6B93E73f57944C8`](https://bscscan.com/address/0xdf4499f5690474F502a774eCF6B93E73f57944C8#code) |
| TowackRouter | [`0x3e4a1E282a6fffB148ddeE01dFB85ca967b6C775`](https://bscscan.com/address/0x3e4a1E282a6fffB148ddeE01dFB85ca967b6C775#code) |
| RebateDistributor | [`0x886e955A7B1f5027d029d2a47Dcd43ad6a1b73cf`](https://bscscan.com/address/0x886e955A7B1f5027d029d2a47Dcd43ad6a1b73cf#code) |
| TeamVesting | [`0x9d2a285d244689221cB49a60ed8C738A4219cEF3`](https://bscscan.com/address/0x9d2a285d244689221cB49a60ed8C738A4219cEF3#code) |
| TimelockController (2-day delay) | [`0x6E908eE594B447efe7C70A50b17E9d583e674D60`](https://bscscan.com/address/0x6E908eE594B447efe7C70A50b17E9d583e674D60#code) |
| AgentDealsV2 (escrow + Agent ID judge juries; used by the app; deployed with a Binance Agentic Wallet) | [`0xE3dE4fA3a8caFd728c38f8C8837610E2EacCEAE3`](https://bscscan.com/address/0xE3dE4fA3a8caFd728c38f8C8837610E2EacCEAE3#code) (also [Sourcify exact match](https://sourcify.dev/server/v2/contract/56/0xE3dE4fA3a8caFd728c38f8C8837610E2EacCEAE3)) |
| AgentDeals v1 (escrow without judges, deployed with a Binance Agentic Wallet) | [`0xc16a1941300a1b1c50eC4062836643F278a6361f`](https://bscscan.com/address/0xc16a1941300a1b1c50eC4062836643F278a6361f#code) (also [Sourcify exact match](https://sourcify.dev/server/v2/contract/56/0xc16a1941300a1b1c50eC4062836643F278a6361f)) |

External: Agent ID registry [`0x60B9…022F`](https://bscscan.com/address/0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F), Chainlink VRF v2.5 direct-funding wrapper [`0x4715…Ac94`](https://bscscan.com/address/0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94), PancakeSwap v2 router [`0x10ED…024E`](https://bscscan.com/address/0x10ED43C718714eb63d5aA57B78B54704E256024E). Full record: [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json) , [deployments/bsc-mainnet-agentdeals.json](deployments/bsc-mainnet-agentdeals.json) and [deployments/bsc-mainnet-agentdealsv2.json](deployments/bsc-mainnet-agentdealsv2.json).

## Proof it works
- **Genesis 300:** 22 Agent ID wallets have claimed on mainnet (at 24 Nov 2026), each one an on-chain Agent ID check.
- **End-to-end with a real Binance Agentic Wallet** (`zeewoo.ai`): exact 100 TWAK approval → [`DrawV2.enter`](https://bscscan.com/tx/0x0c2506f0178e46934fb3e6f79aee9b35472132f5436867b8c4c1cd9ef86d7fe5) → Chainlink VRF spin → [`claim()`](https://bscscan.com/tx/0x8e164161a0ae908b6914ff9243c9aa72b16c9277620c7dc53d4bdf870923b2c0), all through `baw contract-call preview` / `execute`. Swap, bridge and the Aster perps approval were also checked through BAW.
- **Tests:** Foundry 209 passing (+8 mainnet-fork tests, including real Agent ID judges), 2,000-run fuzzing on prize-pool solvency and on deal/jury fund conservation; web 195 passing. CI runs format, build and tests on every push.

## Safety
- **We never ask for keys,** seed phrases, pairing codes or API secrets. There is no QR login and no server wallet: every transaction is signed in the user's own wallet (or their own BAW after an explicit "yes").
- **Exact approvals only,** never unlimited.
- **Agent instructions** always preview first, show the risks, and wait for the user's confirmation. They never bypass it.
- **No promised returns.** Towack is a game of chance, not an investment. Each trading page shows a risk warning; the full risk note is on [/docs](https://towack.vercel.app/docs#risks).
- **Owner permissions are limited and public** (table below). No one can mint TWAK, change fees, pause trading, freeze tokens or withdraw user funds.
- **Not affiliated** with Binance, BNB Chain, PancakeSwap, Chainlink or Aster.

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
| AgentDealsV2 `0xE3dE…EAE3` | none | n/a (fees, windows, quorum and recipients are fixed at deploy) | change fees or the verdict rule, move escrowed funds, or overrule a jury |
| AgentDeals v1 `0xc16a…361f` | none | n/a (fee recipients are fixed at deploy) | change the 1% fee or its recipients, move escrowed funds, or pick sides in a deal |
| TowackGenesis `0x5B30…c73A` | Towack ecosystem wallet `0x38A0…6776` (Ownable2Step; renounce disabled) | `open` / `close` the claim window; `sweepSurplus` sends TWAK not needed for remaining claims back to the ecosystem wallet | take back TWAK already claimed; each claim pays 20,000 TWAK in the same transaction |

## Tokenomics (1,000,000,000 TWAK, fixed)
400M public mint · 200M initial LP (at the mint price, LP burned) · 100M trader rebates (104 weeks) · 70M Draw V2 pool · 50M Draw V1 bonus reserve (unused part burned) · 50M team (1-year cliff, 4-year daily vesting) · 50M seasons & referrals · 50M ecosystem · 30M POL buffer. No transfer tax, no mint function. Details: [/tokenomics](https://towack.vercel.app/tokenomics).

---

## For developers

The name Towack is not an existing crypto token (a 2020 music event used a similar name; this project is unrelated). Contracts are also deployed on BSC testnet (chain 97). The mainnet broadcast followed the checklist in [docs/MAINNET_GO.md](docs/MAINNET_GO.md).

### Layout
- `src/TowackToken.sol`: fixed 1B supply ERC-20, no tax
- `src/TowackGenesis.sol`: Genesis 300 completely free claim (300 cap, flat 20,000 TWAK sent instantly, 6M TWAK budget, Agent ID token-id gate, non-payable: gas only, no VRF). The older VRF Genesis `0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038` is retired (closed, surplus swept)
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
- `web/public/skills/towack/SKILL.md`: the agent skill (Binance Agentic Wallet flows, selectors, revert reasons)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details and [STATUS.md](STATUS.md) for progress.

### Frontend (web/)
Next.js App Router + wagmi/viem/RainbowKit + motion, "Atlas" product design. The production app is locked to BSC mainnet (56) with no network switch; live addresses are in `web/src/config/addresses.json` under `"56"` (the `"97"` section is historical and unused at runtime).
```sh
cd web && npm i && npm run dev        # http://localhost:3000
npm run build                         # production build
npm test                              # vitest
npm run abi                           # forge build + re-export ABIs to web/src/abi/
```
Contract addresses live in `web/src/config/addresses.json` (overridable via `NEXT_PUBLIC_TOWACK_<chain>_<KEY>`, see `web/.env.example`). If an address is missing, that page shows a neutral "Temporarily unavailable" state. Every Towack contract write opens in the user's own wallet; there is no server wallet. Exception: on `/perps`, a trade-only Aster API wallet the user sets up (`canWithdraw=false`) is stored in their browser and signs Aster requests without a per-order popup. See [web/README.md](web/README.md).

### Build & test
```sh
forge build
forge test -vv
FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz
BSC_FORK=1 forge test --match-contract ForkPancake -vv   # real Pancake v2 on a testnet fork
```

### Deploy (testnet only)
Mainnet is already live. Do not re-run the mainnet script; see [docs/MAINNET_GO.md](docs/MAINNET_GO.md) and [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json).
```sh
set -a; source /workspace/secrets/towack-deployer.env; set +a   # PRIVATE_KEY, never committed
forge script script/DeployFullStackTestnet.s.sol --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
```
