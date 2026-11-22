// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TowackToken} from "../src/TowackToken.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {TowackRouter} from "../src/TowackRouter.sol";
import {RebateDistributor} from "../src/RebateDistributor.sol";
import {TeamVesting} from "../src/TeamVesting.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";

/// @notice BSC MAINNET (chainid 56) full-stack deploy. Same contracts and parameters as the testnet referrals
/// stack (0.1 BNB paid mint, 5% referrals, Genesis 300, DrawV2 70M pool, open router, VRF v2.5 direct-funding
/// wrapper, callback gas 165k / 170k / 200k), wired to the REAL mainnet dependencies verified in
/// `deployments/bsc-mainnet.expected.json` (Agent ID registry, Chainlink wrapper, PancakeSwap v2, WBNB).
///
/// THREE ENTRY POINTS, from safe to dangerous:
///
///  1. dryRun()   — DEFAULT. Pure simulation against a mainnet RPC. Refuses --broadcast / --resume. No key needed.
///       forge script script/DeployFullStackMainnet.s.sol --sig "dryRun()" --rpc-url bsc_mainnet
///
///  2. forkRun()  — Broadcasts ONLY to a local anvil fork. Refuses any node whose web3_clientVersion is not anvil.
///       anvil --fork-url https://bsc-rpc.publicnode.com --port 8545 &
///       PRIVATE_KEY=<anvil test key #0> forge script script/DeployFullStackMainnet.s.sol --sig "forkRun()" \
///         --rpc-url http://127.0.0.1:8545 --broadcast --slow
///     Writes deployments/out/bsc-mainnet-FORK.addresses.json (gitignored; FORK addresses, never real).
///
///  3. run()      — REAL MAINNET BROADCAST. MATEEN-ONLY. DO NOT RUN UNTIL MATEEN SAYS GO.
///     Requires TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO, MAINNET_DEPLOYER (= vm.addr(PRIVATE_KEY)), a funded deployer
///     (GAS_RESERVE), refuses to run on anvil, and refuses EOA-default recipients unless ALLOW_DEPLOYER_RECIPIENTS=true.
///       set -a; source <mainnet deployer env>; set +a        # never echo it
///       TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO MAINNET_DEPLOYER=0x... SEASONS_WALLET=0x... ECOSYSTEM_WALLET=0x... \
///       POL_BUFFER_WALLET=0x... TEAM_BENEFICIARY=0x... DEV_WALLET=0x... TIMELOCK_PROPOSER=0x... \
///       forge script script/DeployFullStackMainnet.s.sol --sig "run()" --rpc-url bsc_mainnet \
///         --broadcast --slow --with-gas-price 0.1gwei
///     Writes deployments/out/bsc-mainnet.addresses.json (copy into web/src/config/addresses.json chain 56).
///
/// Optional env (all entry points): MINT_START (unix, default now), MINT_DURATION (default 7 days),
/// TIMELOCK_DELAY (default 48h, min 24h), GENESIS_OWNER (default deployer; Ownable2Step), SEASONS_WALLET,
/// ECOSYSTEM_WALLET, POL_BUFFER_WALLET, TEAM_BENEFICIARY, DEV_WALLET, TIMELOCK_PROPOSER (default: deployer).
/// Genesis is funded (8M) and opened in-script only when ECOSYSTEM_WALLET == deployer; otherwise the ecosystem
/// wallet must later `approve(genesis, 8M)`, call `genesis.fund(8M)`, and the Genesis owner calls `open()`.
///
/// Ownership after deploy (no EOA-only irreversible traps):
///  - TimelockController(delay, proposers/executors = [TIMELOCK_PROPOSER], admin = none / self-administered).
///  - DrawV2 owner = timelock (can only pause NEW entries).
///  - RebateDistributor.routerAdmin = timelock (router changes are delayed + public).
///  - TowackGenesis owner = GENESIS_OWNER (Ownable2Step: can be handed to the timelock / a multisig later).
///  - Launch, Token, Router, TeamVesting: ownerless. Bind steps are set-once deployer calls done in this script.
contract DeployFullStackMainnet is Script {
    // ---------------------------------------------------------------- verified mainnet dependencies
    /// SPACE ID "Agent ID" registry (soulbound ERC-721, symbol "AI"): balanceOf / ownerOf / handleOf / ownerOfHandle.
    address public constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    /// Chainlink VRFV2PlusWrapper 1.0.0 (docs.chain.link/vrf/v2-5/supported-networks, BNB Chain mainnet, direct funding).
    address public constant VRF_WRAPPER = 0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94;
    /// Chainlink VRFCoordinatorV2_5 (same docs). Checked against VRF_WRAPPER.s_vrfCoordinator().
    address public constant VRF_COORDINATOR = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
    /// PancakeSwap v2 (developer.pancakeswap.finance/contracts/v2/addresses).
    address public constant PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    /// WBNB (== PANCAKE_ROUTER.WETH()).
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;

    // ---------------------------------------------------------------- params (same as testnet)
    uint32 public constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 public constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 public constant DRAW_CALLBACK_GAS = 200_000;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint256 public constant GENESIS_BUDGET = 8_000_000e18;
    uint256 public constant MIN_TIMELOCK_DELAY = 24 hours;
    /// ~16.5M deploy gas: 0.0165 BNB at 1 gwei. 0.03 BNB leaves room for gas-price moves (BSC runs ~0.05-0.1 gwei).
    uint256 public constant GAS_RESERVE = 0.03 ether;
    /// Placeholder simulation sender for dryRun() when MAINNET_DEPLOYER is unset (no key, no funds needed).
    address internal constant SIM_DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    /// Real testnet deployer EOA — refused in forkRun() so fork rehearsals never touch the real key.
    address internal constant TESTNET_DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    string internal constant GO_PHRASE = "I_HAVE_MATEENS_GO";

    struct Cfg {
        address deployer;
        address seasons;
        address ecosystem;
        address polBuffer;
        address teamBeneficiary;
        address dev;
        address proposer;
        address genesisOwner;
        uint256 mintStart;
        uint256 mintDuration;
        uint256 tlDelay;
    }

    struct Out {
        address timelock;
        address drawV2;
        address launch;
        address rebates;
        address team;
        address token;
        address pair;
        address router;
        address genesis;
        uint256 mintStart;
        uint256 mintEnd;
        bool genesisOpened;
    }

    // ================================================================= entry points
    function dryRun() external returns (Out memory o) {
        require(
            !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
            "DRY RUN ONLY: refusing --broadcast/--resume"
        );
        require(block.chainid == 56, "BSC mainnet (or a mainnet fork) only");
        Cfg memory c = _cfg(vm.envOr("MAINNET_DEPLOYER", SIM_DEPLOYER));
        _checkDeps();
        vm.startBroadcast(c.deployer);
        o = _deploy(c);
        vm.stopBroadcast();
        _verify(c, o);
        _log(c, o);
        console2.log("DRY RUN ONLY: addresses above are simulated; nothing was sent");
    }

    function forkRun() external returns (Out memory o) {
        require(block.chainid == 56, "mainnet fork only");
        require(_isAnvil(), "forkRun(): node is not anvil; refusing to broadcast");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(pk);
        require(sender != TESTNET_DEPLOYER, "forkRun(): use an anvil test key, never the real deployer key");
        Cfg memory c = _cfg(sender);
        _checkDeps();
        vm.startBroadcast(pk);
        o = _deploy(c);
        vm.stopBroadcast();
        _verify(c, o);
        _log(c, o);
        _writeManifest(c, o, "deployments/out/bsc-mainnet-FORK.addresses.json", true);
    }

    /// MATEEN-ONLY. DO NOT RUN UNTIL MATEEN SAYS GO.
    function run() external returns (Out memory o) {
        require(block.chainid == 56, "BSC mainnet only");
        require(
            keccak256(bytes(vm.envOr("TOWACK_MAINNET_GO", string("")))) == keccak256(bytes(GO_PHRASE)),
            "mainnet broadcast blocked: set TOWACK_MAINNET_GO only after Mateen says go"
        );
        require(!_isAnvil(), "run() is the real mainnet path; use forkRun() on anvil");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address want = vm.envAddress("MAINNET_DEPLOYER");
        require(vm.addr(pk) == want, "PRIVATE_KEY does not match MAINNET_DEPLOYER");
        Cfg memory c = _cfg(want);
        if (!vm.envOr("ALLOW_DEPLOYER_RECIPIENTS", false)) {
            require(
                c.seasons != want && c.ecosystem != want && c.polBuffer != want && c.teamBeneficiary != want
                    && c.dev != want && c.proposer != want,
                "set SEASONS/ECOSYSTEM/POL_BUFFER/TEAM_BENEFICIARY/DEV/TIMELOCK_PROPOSER wallets (multisigs) or ALLOW_DEPLOYER_RECIPIENTS=true"
            );
        }
        require(want.balance >= GAS_RESERVE, "deployer BNB < GAS_RESERVE");
        _checkDeps();
        vm.startBroadcast(pk);
        o = _deploy(c);
        vm.stopBroadcast();
        _verify(c, o);
        _log(c, o);
        _writeManifest(c, o, "deployments/out/bsc-mainnet.addresses.json", false);
    }

    // ================================================================= internals
    function _cfg(address deployer) internal view returns (Cfg memory c) {
        c.deployer = deployer;
        c.seasons = vm.envOr("SEASONS_WALLET", deployer);
        c.ecosystem = vm.envOr("ECOSYSTEM_WALLET", deployer);
        c.polBuffer = vm.envOr("POL_BUFFER_WALLET", deployer);
        c.teamBeneficiary = vm.envOr("TEAM_BENEFICIARY", deployer);
        c.dev = vm.envOr("DEV_WALLET", deployer);
        c.proposer = vm.envOr("TIMELOCK_PROPOSER", deployer);
        c.genesisOwner = vm.envOr("GENESIS_OWNER", deployer);
        c.mintStart = vm.envOr("MINT_START", block.timestamp);
        c.mintDuration = vm.envOr("MINT_DURATION", uint256(7 days));
        c.tlDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));
        require(c.tlDelay >= MIN_TIMELOCK_DELAY, "TIMELOCK_DELAY < 24h");
        require(c.mintDuration >= 1 days, "MINT_DURATION < 1 day");
        require(c.mintStart + 1 hours >= block.timestamp, "MINT_START in the past");
    }

    function _isAnvil() internal returns (bool) {
        try vm.rpc("web3_clientVersion", "[]") returns (bytes memory r) {
            bytes memory s = bytes(abi.decode(r, (string)));
            return s.length >= 5 && s[0] == "a" && s[1] == "n" && s[2] == "v" && s[3] == "i" && s[4] == "l";
        } catch {
            return false;
        }
    }

    /// Re-checks every external dependency on the target chain before sending anything.
    function _checkDeps() internal view {
        require(AGENT_ID.code.length > 0, "Agent ID registry has no code");
        require(VRF_WRAPPER.code.length > 0, "VRF wrapper has no code");
        require(VRF_COORDINATOR.code.length > 0, "VRF coordinator has no code");
        require(PANCAKE_FACTORY.code.length > 0 && PANCAKE_ROUTER.code.length > 0, "Pancake has no code");
        require(WBNB.code.length > 0, "WBNB has no code");
        (bool ok, bytes memory r) = PANCAKE_ROUTER.staticcall(abi.encodeWithSignature("WETH()"));
        require(ok && abi.decode(r, (address)) == WBNB, "router.WETH() != WBNB");
        (ok, r) = PANCAKE_ROUTER.staticcall(abi.encodeWithSignature("factory()"));
        require(ok && abi.decode(r, (address)) == PANCAKE_FACTORY, "router.factory() != factory");
        (ok, r) = VRF_WRAPPER.staticcall(abi.encodeWithSignature("s_vrfCoordinator()"));
        require(ok && abi.decode(r, (address)) == VRF_COORDINATOR, "wrapper coordinator mismatch");
        (ok, r) = VRF_WRAPPER.staticcall(abi.encodeWithSignature("s_configured()"));
        require(ok && abi.decode(r, (bool)), "wrapper not configured");
        (ok, r) = VRF_WRAPPER.staticcall(abi.encodeWithSignature("s_disabled()"));
        require(ok && !abi.decode(r, (bool)), "wrapper is disabled");
        require(
            IVRFV2PlusWrapper(VRF_WRAPPER).estimateRequestPriceNative(DRAW_CALLBACK_GAS, 1, 1 gwei) > 0,
            "wrapper quote is 0"
        );
        // Verify SPACE ID HandleRegistry (soulbound ERC-721: balanceOf, handleOf, ownerOfHandle).
        (ok, r) = AGENT_ID.staticcall(abi.encodeWithSignature("balanceOf(address)", address(0xdead)));
        require(ok && abi.decode(r, (uint256)) == 0, "Agent ID balanceOf failed");
        (ok, r) = AGENT_ID.staticcall(abi.encodeWithSignature("handleOf(address)", address(0xdead)));
        require(ok && bytes(abi.decode(r, (string))).length == 0, "Agent ID handleOf failed");
        (ok, r) = AGENT_ID.staticcall(abi.encodeWithSignature("ownerOfHandle(string)", "__towack_probe__"));
        require(ok && abi.decode(r, (address)) == address(0), "Agent ID ownerOfHandle failed");
    }

    function _vrf(uint32 gasLimit) internal pure returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({
            wrapper: VRF_WRAPPER,
            requestConfirmations: REQUEST_CONFIRMATIONS,
            callbackGasLimit: gasLimit
        });
    }

    function _deploy(Cfg memory c) internal returns (Out memory o) {
        address[] memory roles = new address[](1);
        roles[0] = c.proposer;
        o.timelock = address(new TimelockController(c.tlDelay, roles, roles, address(0)));

        o.drawV2 = address(new DrawV2(o.timelock, address(0), _vrf(DRAW_CALLBACK_GAS)));
        o.mintStart = c.mintStart;
        o.mintEnd = c.mintStart + c.mintDuration;
        o.launch = address(
            new TowackLaunch(AGENT_ID, WBNB, o.drawV2, o.mintStart, o.mintEnd, _vrf(LAUNCH_CALLBACK_GAS), false)
        );
        o.rebates = address(new RebateDistributor());
        o.team = address(new TeamVesting(c.teamBeneficiary));
        o.token = address(
            new TowackToken(
                TowackToken.Recipients({
                    launch: o.launch,
                    rebates: o.rebates,
                    team: o.team,
                    drawV2: o.drawV2,
                    seasons: c.seasons,
                    ecosystem: c.ecosystem,
                    polBuffer: c.polBuffer
                }),
                PANCAKE_FACTORY,
                WBNB
            )
        );
        TowackLaunch(payable(o.launch)).bindToken(o.token);
        TeamVesting(o.team).bindToken(o.token);
        DrawV2(payable(o.drawV2)).bindToken(o.token);
        o.pair = TowackToken(o.token).pair();
        o.router = address(new TowackRouter(o.token, PANCAKE_ROUTER, AGENT_ID, o.rebates, o.drawV2, c.dev));
        RebateDistributor(payable(o.rebates)).bind(o.token, o.router);
        RebateDistributor(payable(o.rebates)).setRouterAdmin(o.timelock);

        o.genesis = address(
            new TowackGenesis(o.token, AGENT_ID, c.ecosystem, c.genesisOwner, _vrf(GENESIS_CALLBACK_GAS))
        );
        if (c.ecosystem == c.deployer) {
            TowackToken(o.token).approve(o.genesis, GENESIS_BUDGET);
            TowackGenesis(o.genesis).fund(GENESIS_BUDGET);
            if (c.genesisOwner == c.deployer) {
                TowackGenesis(o.genesis).open();
                o.genesisOpened = true;
            }
        }
    }

    /// Post-deploy invariants (simulated in dryRun, real reads after forkRun/run).
    function _verify(Cfg memory c, Out memory o) internal view {
        TowackToken t = TowackToken(o.token);
        require(t.totalSupply() == 1_000_000_000e18, "supply");
        require(t.balanceOf(o.launch) == 650_000_000e18, "launch alloc");
        require(t.balanceOf(o.drawV2) == 70_000_000e18, "drawV2 pool 70M");
        require(t.balanceOf(o.rebates) == 100_000_000e18, "rebates alloc");
        require(t.balanceOf(o.team) == 50_000_000e18, "team alloc");
        require(!t.tradingOpen(), "trading must be closed until listing");
        TowackLaunch l = TowackLaunch(payable(o.launch));
        require(address(l.agentId()) == AGENT_ID && address(l.wbnb()) == WBNB, "launch deps");
        require(!l.instantClose(), "mainnet: instantClose must be false");
        require(l.pair() == o.pair && l.drawV2Treasury() == o.drawV2, "launch wiring");
        require(l.MINT_PRICE() == 0.1 ether && l.REFERRAL_FEE() == 0.005 ether, "mint/referral params");
        require(l.prizeBnb(0) + l.REFERRAL_FEE() <= l.MINT_PRICE(), "referral solvency");
        require(VRFConsumerV25(o.launch).vrfCallbackGasLimit() == LAUNCH_CALLBACK_GAS, "launch cb gas");
        require(VRFConsumerV25(o.genesis).vrfCallbackGasLimit() == GENESIS_CALLBACK_GAS, "genesis cb gas");
        require(VRFConsumerV25(o.drawV2).vrfCallbackGasLimit() == DRAW_CALLBACK_GAS, "draw cb gas");
        require(address(VRFConsumerV25(o.launch).vrfWrapper()) == VRF_WRAPPER, "wrapper");
        require(DrawV2(payable(o.drawV2)).owner() == o.timelock, "drawV2 owner");
        RebateDistributor r = RebateDistributor(payable(o.rebates));
        require(r.router() == o.router && r.routerAdmin() == o.timelock, "rebates wiring");
        TowackRouter ro = TowackRouter(payable(o.router));
        require(address(ro.agentId()) == AGENT_ID && ro.wbnb() == WBNB && ro.lotteryTreasury() == o.drawV2, "router");
        TowackGenesis g = TowackGenesis(o.genesis);
        require(address(g.agentId()) == AGENT_ID && g.owner() == c.genesisOwner, "genesis");
        if (o.genesisOpened) require(t.balanceOf(o.genesis) == GENESIS_BUDGET && g.isOpen(), "genesis funded+open");
        TimelockController tl = TimelockController(payable(o.timelock));
        require(tl.getMinDelay() == c.tlDelay, "timelock delay");
        require(tl.hasRole(tl.PROPOSER_ROLE(), c.proposer) && tl.hasRole(tl.EXECUTOR_ROLE(), c.proposer), "tl roles");
        require(!tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), c.deployer), "timelock must be self-administered");
    }

    function _log(Cfg memory c, Out memory o) internal view {
        console2.log("== Towack BSC MAINNET stack (chain 56)");
        console2.log("deployer", c.deployer);
        console2.log("agentId", AGENT_ID);
        console2.log("vrfWrapper", VRF_WRAPPER);
        console2.log("timelock", o.timelock);
        console2.log("drawV2", o.drawV2);
        console2.log("launch", o.launch);
        console2.log("rebates", o.rebates);
        console2.log("team", o.team);
        console2.log("token", o.token);
        console2.log("pair", o.pair);
        console2.log("router", o.router);
        console2.log("genesis", o.genesis);
        console2.log("mintStart", o.mintStart);
        console2.log("mintEnd", o.mintEnd);
        console2.log("genesisOpened", o.genesisOpened);
        if (
            c.seasons == c.deployer || c.ecosystem == c.deployer || c.polBuffer == c.deployer
                || c.proposer == c.deployer || c.genesisOwner == c.deployer
        ) {
            console2.log(
                "WARNING: some allocation or admin roles default to the deployer EOA (use multisigs on mainnet)"
            );
        }
        console2.log("Launch VRF fee @ 0.1 gwei (wei)", VRFConsumerV25(o.launch).vrfFeeAt(0.1 gwei));
        console2.log("Genesis VRF fee @ 0.1 gwei (wei)", VRFConsumerV25(o.genesis).vrfFeeAt(0.1 gwei));
        console2.log("DrawV2 VRF fee @ 0.1 gwei (wei)", VRFConsumerV25(o.drawV2).vrfFeeAt(0.1 gwei));
    }

    /// Frontend manifest: same keys as web/src/config/addresses.json (chain 56 block).
    function _writeManifest(Cfg memory c, Out memory o, string memory path, bool fork) internal {
        string memory k = "m";
        vm.serializeBool(k, "FORK_ONLY_NOT_A_LIVE_DEPLOY", fork);
        vm.serializeUint(k, "chainId", 56);
        vm.serializeAddress(k, "deployer", c.deployer);
        vm.serializeUint(k, "mintStart", o.mintStart);
        vm.serializeUint(k, "mintEnd", o.mintEnd);
        vm.serializeAddress(k, "agentId", AGENT_ID);
        vm.serializeAddress(k, "token", o.token);
        vm.serializeAddress(k, "launch", o.launch);
        vm.serializeAddress(k, "router", o.router);
        vm.serializeAddress(k, "rebateDistributor", o.rebates);
        vm.serializeAddress(k, "teamVesting", o.team);
        vm.serializeAddress(k, "drawV2", o.drawV2);
        vm.serializeAddress(k, "timelock", o.timelock);
        vm.serializeAddress(k, "genesis", o.genesis);
        vm.serializeAddress(k, "pair", o.pair);
        vm.serializeAddress(k, "wbnb", WBNB);
        vm.serializeAddress(k, "pancakeRouter", PANCAKE_ROUTER);
        vm.serializeAddress(k, "pancakeFactory", PANCAKE_FACTORY);
        vm.serializeAddress(k, "vrfCoordinator", VRF_COORDINATOR);
        string memory json = vm.serializeAddress(k, "vrfWrapper", VRF_WRAPPER);
        vm.writeJson(json, path);
        console2.log("manifest written:", path);
    }
}
