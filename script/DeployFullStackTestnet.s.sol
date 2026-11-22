// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TowackToken} from "../src/TowackToken.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {TowackRouter} from "../src/TowackRouter.sol";
import {RebateDistributor} from "../src/RebateDistributor.sol";
import {TeamVesting} from "../src/TeamVesting.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {IVRFCoordinatorV2Plus} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Full-stack redeploy onto an EXISTING official VRF v2.5
/// native-payment subscription. Never tops up the sub (users pay per request). Never runs on mainnet.
///
/// Keyless preview (simulation only; NEVER pass --broadcast):
///   VRF_SUB_ID=<id> forge script script/DeployFullStackTestnet.s.sol --sig "dryRun()" \
///     --rpc-url bsc_testnet --legacy --with-gas-price 1gwei
///
/// Broadcast:
///   set -a; source /workspace/secrets/towack-deployer.env; set +a   # do not echo
///   VRF_SUB_ID=<id> MINT_DURATION=604800 forge script script/DeployFullStackTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
///
/// Required env (broadcast): PRIVATE_KEY, VRF_SUB_ID (must be owned by the deployer; no fund tx).
/// Optional: MINT_DURATION (default 7 days), TIMELOCK_DELAY (default 48h),
///           AGENT_ID (default existing MockAgentId), AGENT_ID_NFT (default existing MockAgentIdNFT),
///           REMOVE_OLD_CONSUMERS (default true).
contract DeployFullStackTestnet is Script {
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    address constant COORDINATOR = 0xDA3b641D438362C440Ac5458c57e00a712b66700;
    bytes32 constant KEY_HASH_50GWEI = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    address constant PANCAKE_FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant DEFAULT_AGENT_ID = 0xfF5f224349e6aDB7754249d5e4352dB0910717B7;
    address constant DEFAULT_AGENT_ID_NFT = 0x70BC7133E62427DAE709299454ed8c9015898036;
    // Previous official-VRF consumers on the reused sub (remove after the new ones are added).
    address constant OLD_GENESIS = 0x9BDEf589e2669A10e416Ae4357DE4d85B2C1b97F;
    address constant OLD_DRAW_V2 = 0xC6f7B7062757A0Aa9F91d4551B3C9ab73B0079Fd;

    uint32 constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 constant DRAW_CALLBACK_GAS = 200_000;
    uint256 constant GENESIS_BUDGET = 8_000_000e18;
    uint256 constant GAS_RESERVE = 0.005 ether;

    struct Out {
        uint256 subId;
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
    }

    function dryRun() external returns (Out memory o) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 subId = vm.envUint("VRF_SUB_ID");
        _assertSub(subId);
        vm.startBroadcast(DEPLOYER);
        o = _deploy(subId);
        vm.stopBroadcast();
        _log(o);
        console2.log("DRY RUN ONLY: addresses above are simulated");
    }

    function run() external returns (Out memory o) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "unexpected deployer");
        uint256 subId = vm.envUint("VRF_SUB_ID");
        _assertSub(subId);
        require(DEPLOYER.balance >= GAS_RESERVE, "deployer tBNB < GAS_RESERVE");
        vm.startBroadcast(pk);
        o = _deploy(subId);
        vm.stopBroadcast();
        _log(o);
    }

    function _assertSub(uint256 subId) internal view {
        (,,, address owner,) = IVRFCoordinatorV2Plus(COORDINATOR).getSubscription(subId);
        require(owner == DEPLOYER, "sub not owned by deployer");
    }

    function _cfg(uint256 subId, uint32 gasLimit) internal pure returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({
            coordinator: COORDINATOR,
            keyHash: KEY_HASH_50GWEI,
            subId: subId,
            requestConfirmations: 3,
            callbackGasLimit: gasLimit,
            nativePayment: true,
            minFeeGasPrice: 1 gwei,
            maxFeeGasPrice: 50 gwei
        });
    }

    function _deploy(uint256 subId) internal returns (Out memory o) {
        o.subId = subId;
        o.agentId = vm.envOr("AGENT_ID", DEFAULT_AGENT_ID);
        o.agentIdNft = vm.envOr("AGENT_ID_NFT", DEFAULT_AGENT_ID_NFT);
        uint256 mintDuration = vm.envOr("MINT_DURATION", uint256(7 days));
        uint256 tlDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));
        IVRFCoordinatorV2Plus coord = IVRFCoordinatorV2Plus(COORDINATOR);

        address[] memory admins = new address[](1);
        admins[0] = DEPLOYER;
        o.timelock = address(new TimelockController(tlDelay, admins, admins, address(0)));

        o.drawV2 = address(new DrawV2(o.timelock, address(0), _cfg(subId, DRAW_CALLBACK_GAS)));
        o.mintStart = block.timestamp;
        o.mintEnd = block.timestamp + mintDuration;
        o.launch = address(
            new TowackLaunch(o.agentId, WBNB, o.drawV2, o.mintStart, o.mintEnd, _cfg(subId, LAUNCH_CALLBACK_GAS))
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
            new TowackGenesis(o.token, o.agentIdNft, DEPLOYER, DEPLOYER, _cfg(subId, GENESIS_CALLBACK_GAS))
        );
        TowackToken(o.token).approve(o.genesis, GENESIS_BUDGET);
        TowackGenesis(o.genesis).fund(GENESIS_BUDGET);
        TowackGenesis(o.genesis).open();

        coord.addConsumer(subId, o.launch);
        coord.addConsumer(subId, o.genesis);
        coord.addConsumer(subId, o.drawV2);

        if (vm.envOr("REMOVE_OLD_CONSUMERS", true)) {
            coord.removeConsumer(subId, OLD_GENESIS);
            coord.removeConsumer(subId, OLD_DRAW_V2);
        }
    }

    function _log(Out memory o) internal view {
        (, uint96 nb,, address owner, address[] memory cons) =
            IVRFCoordinatorV2Plus(COORDINATOR).getSubscription(o.subId);
        console2.log("== full-stack testnet redeploy (official VRF, reused sub, no top-up)");
        console2.log("subId", o.subId);
        console2.log("sub owner", owner);
        console2.log("sub native balance (wei)", uint256(nb));
        console2.log("sub consumers", cons.length);
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
        console2.log("deployer tBNB left (wei)", DEPLOYER.balance);
        console2.log("Launch callback", VRFConsumerV25(o.launch).vrfCallbackGasLimit());
        console2.log("Genesis callback", VRFConsumerV25(o.genesis).vrfCallbackGasLimit());
        console2.log("DrawV2 callback", VRFConsumerV25(o.drawV2).vrfCallbackGasLimit());
        console2.log("Genesis fee @ 1 gwei (wei)", VRFConsumerV25(o.genesis).vrfFeeAt(1 gwei));
        console2.log("DrawV2 fee @ 1 gwei (wei)", VRFConsumerV25(o.drawV2).vrfFeeAt(1 gwei));
        console2.log("Launch fee @ 1 gwei (wei)", VRFConsumerV25(o.launch).vrfFeeAt(1 gwei));
    }
}
