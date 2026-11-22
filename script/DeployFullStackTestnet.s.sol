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

/// @notice BSC TESTNET ONLY (chainid 97). Full-stack redeploy on the official Chainlink VRF v2.5 DIRECT-FUNDING
/// WRAPPER (native tBNB, paid per request by the user). No subscription: nothing to create, fund, or add consumers
/// to. Never runs on mainnet.
///
/// Keyless preview (simulation only; NEVER pass --broadcast):
///   forge script script/DeployFullStackTestnet.s.sol --sig "dryRun()" \
///     --rpc-url bsc_testnet --legacy --with-gas-price 1gwei
///
/// Broadcast (Grok / the operator only):
///   set -a; source /workspace/secrets/towack-deployer.env; set +a   # do not echo
///   MINT_DURATION=604800 forge script script/DeployFullStackTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
///
/// Instant-list REHEARSAL stack (a SEPARATE stack; leaves the live web/src/config/addresses.json stack alone and
/// this script never writes that file). Same 7-day window, but Launch is deployed with `instantClose = true`, so
/// right after one paid mint + its VRF callback anyone can call closeMint() + finalizeListing() and trading opens:
///   INSTANT_CLOSE=true forge script script/DeployFullStackTestnet.s.sol --sig "dryRun()" \
///     --rpc-url bsc_testnet --legacy --with-gas-price 1gwei
///   INSTANT_CLOSE=true forge script script/DeployFullStackTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
/// (or script/DeployRehearsalStackTestnet.s.sol, which forces instantClose = true). Keep MINT_DURATION at its
/// 7-day default: instant close is what makes the stack listable at once, and a very short window could expire
/// during the remaining deploy txs (mint() would then revert MintNotOpen).
///
/// Required env (broadcast): PRIVATE_KEY.
/// Optional: INSTANT_CLOSE (default false; rehearsal only), VRF_WRAPPER (default: official BSC testnet wrapper),
///           MINT_DURATION (default 7 days),
///           TIMELOCK_DELAY (default 48h), AGENT_ID (default existing MockAgentId),
///           AGENT_ID_NFT (default existing MockAgentIdNFT).
/// Precheck: deployer balance >= GAS_RESERVE (deploy gas at 1 gwei is ~0.016 tBNB; no VRF deposit of any kind).
contract DeployFullStackTestnet is Script {
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    /// Official VRFV2PlusWrapper on BSC testnet (docs.chain.link/vrf/v2-5/supported-networks). Its key hash is the
    /// 50 gwei lane; coordinator 0xDA3b641D438362C440Ac5458c57e00a712b66700.
    address constant DEFAULT_VRF_WRAPPER = 0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94;
    address constant PANCAKE_FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant DEFAULT_AGENT_ID = 0xfF5f224349e6aDB7754249d5e4352dB0910717B7;
    address constant DEFAULT_AGENT_ID_NFT = 0x70BC7133E62427DAE709299454ed8c9015898036;

    uint32 constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 constant DRAW_CALLBACK_GAS = 200_000;
    uint256 constant GENESIS_BUDGET = 8_000_000e18;
    /// ~16.0M gas at 1 gwei = 0.016 tBNB, plus a small margin. No VRF deposit (the wrapper is paid per request).
    uint256 constant GAS_RESERVE = 0.02 ether;

    struct Out {
        address vrfWrapper;
        uint256 mintStart;
        uint256 mintEnd;
        address agentId;
        address agentIdNft;
        address timelock;
        address drawV2;
        address launch;
        address rebates;
        address team;
        address token;
        address pair;
        address router;
        address genesis;
        bool instantClose;
    }

    /// Instant-close flag for Launch. Default false (production-shaped). The rehearsal alias overrides this.
    function _instantClose() internal view virtual returns (bool) {
        return vm.envOr("INSTANT_CLOSE", false);
    }

    function dryRun() external returns (Out memory o) {
        require(
            !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
            "DRY RUN ONLY: refusing --broadcast/--resume"
        );
        require(block.chainid == 97, "BSC testnet only");
        address w = _wrapper();
        vm.startBroadcast(DEPLOYER);
        o = _deploy(w);
        vm.stopBroadcast();
        _log(o);
        console2.log("DRY RUN ONLY: addresses above are simulated");
    }

    function run() external returns (Out memory o) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "unexpected deployer");
        address w = _wrapper();
        require(DEPLOYER.balance >= GAS_RESERVE, "deployer tBNB < GAS_RESERVE");
        vm.startBroadcast(pk);
        o = _deploy(w);
        vm.stopBroadcast();
        _log(o);
    }

    /// Wrapper sanity: has code, quotes a non-zero native price at 1 gwei for our largest limit.
    function _wrapper() internal view returns (address w) {
        w = vm.envOr("VRF_WRAPPER", DEFAULT_VRF_WRAPPER);
        require(w.code.length > 0, "VRF_WRAPPER has no code");
        require(
            IVRFV2PlusWrapper(w).estimateRequestPriceNative(DRAW_CALLBACK_GAS, 1, 1 gwei) > 0, "wrapper quote is 0"
        );
    }

    function _cfg(address wrapper, uint32 gasLimit) internal pure returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({wrapper: wrapper, requestConfirmations: 3, callbackGasLimit: gasLimit});
    }

    function _deploy(address wrapper) internal returns (Out memory o) {
        o.vrfWrapper = wrapper;
        o.agentId = vm.envOr("AGENT_ID", DEFAULT_AGENT_ID);
        o.agentIdNft = vm.envOr("AGENT_ID_NFT", DEFAULT_AGENT_ID_NFT);
        uint256 mintDuration = vm.envOr("MINT_DURATION", uint256(7 days));
        uint256 tlDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));

        address[] memory admins = new address[](1);
        admins[0] = DEPLOYER;
        o.timelock = address(new TimelockController(tlDelay, admins, admins, address(0)));

        o.drawV2 = address(new DrawV2(o.timelock, address(0), _cfg(wrapper, DRAW_CALLBACK_GAS)));
        o.mintStart = block.timestamp;
        o.mintEnd = block.timestamp + mintDuration;
        o.instantClose = _instantClose();
        o.launch = address(
            new TowackLaunch(
                o.agentId, WBNB, o.drawV2, o.mintStart, o.mintEnd, _cfg(wrapper, LAUNCH_CALLBACK_GAS), o.instantClose
            )
        );
        o.rebates = address(new RebateDistributor());
        o.team = address(new TeamVesting(DEPLOYER));
        o.token = address(
            new TowackToken(
                TowackToken.Recipients({
                    launch: o.launch,
                    rebates: o.rebates,
                    team: o.team,
                    drawV2: o.drawV2,
                    seasons: DEPLOYER,
                    ecosystem: DEPLOYER,
                    polBuffer: DEPLOYER
                }),
                PANCAKE_FACTORY,
                WBNB
            )
        );
        TowackLaunch(payable(o.launch)).bindToken(o.token);
        TeamVesting(o.team).bindToken(o.token);
        DrawV2(payable(o.drawV2)).bindToken(o.token);
        o.pair = TowackToken(o.token).pair();
        o.router = address(new TowackRouter(o.token, PANCAKE_ROUTER, o.agentId, o.rebates, o.drawV2, DEPLOYER));
        RebateDistributor(payable(o.rebates)).bind(o.token, o.router);

        o.genesis = address(
            new TowackGenesis(o.token, o.agentIdNft, DEPLOYER, DEPLOYER, _cfg(wrapper, GENESIS_CALLBACK_GAS))
        );
        TowackToken(o.token).approve(o.genesis, GENESIS_BUDGET);
        TowackGenesis(o.genesis).fund(GENESIS_BUDGET);
        TowackGenesis(o.genesis).open();
    }

    function _log(Out memory o) internal view {
        console2.log("== full-stack testnet redeploy (official VRF v2.5 direct-funding wrapper, native, no sub)");
        console2.log("vrfWrapper", o.vrfWrapper);
        console2.log("agentId", o.agentId);
        console2.log("agentIdNft", o.agentIdNft);
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
        console2.log("instantClose", TowackLaunch(payable(o.launch)).instantClose());
        if (o.instantClose) console2.log("REHEARSAL stack: separate from addresses.json; do NOT write it there");
        console2.log("deployer tBNB left (wei)", DEPLOYER.balance);
        console2.log("Launch callback", VRFConsumerV25(o.launch).vrfCallbackGasLimit());
        console2.log("Genesis callback", VRFConsumerV25(o.genesis).vrfCallbackGasLimit());
        console2.log("DrawV2 callback", VRFConsumerV25(o.drawV2).vrfCallbackGasLimit());
        console2.log("Genesis fee @ 1 gwei (wei)", VRFConsumerV25(o.genesis).vrfFeeAt(1 gwei));
        console2.log("DrawV2 fee @ 1 gwei (wei)", VRFConsumerV25(o.drawV2).vrfFeeAt(1 gwei));
        console2.log("Launch fee @ 1 gwei (wei)", VRFConsumerV25(o.launch).vrfFeeAt(1 gwei));
        console2.log(
            "Launch exact wrapper price @ 1 gwei (wei)",
            IVRFV2PlusWrapper(o.vrfWrapper).estimateRequestPriceNative(LAUNCH_CALLBACK_GAS, 1, 1 gwei)
        );
    }
}
