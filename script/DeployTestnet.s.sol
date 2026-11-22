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
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentId} from "../src/mocks/MockAgentId.sol";
import {IVRFCoordinatorV2Plus} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Refuses to run anywhere else.
///
/// Usage (key is read from the environment, never logged):
///   set -a; source /workspace/secrets/towack-deployer.env; set +a
///   forge script script/DeployTestnet.s.sol --rpc-url bsc_testnet --broadcast
///
/// FULL STACK redeploy (token + Launch + DrawV2 ...). NOT used for the current testnet: the live Launch
/// `0x3772…8b` is ownerless and holds 650M TWAK, so the stack stays until a full redeploy is approved.
///
/// Required env: VRF_SUB_ID (existing native-payment subscription owned by the deployer)
/// Optional env:
///   AGENT_ID          Agent ID registry (default: deploy MockAgentId)
///   VRF_COORDINATOR   default: official Chainlink VRF v2.5 BSC testnet coordinator
///   VRF_KEY_HASH      default: official 50 gwei lane; VRF_NATIVE (default true); VRF_CALLBACK_GAS (default 250k)
///   TEAM_WALLET, SEASONS_WALLET, ECOSYSTEM_WALLET, POL_WALLET, DEV_WALLET (default: deployer)
///   MINT_DURATION     seconds (default 3 days); mint starts at deploy
///   TIMELOCK_DELAY    seconds (default 48h)
contract DeployTestnet is Script {
    address constant PANCAKE_FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant OFFICIAL_VRF_COORDINATOR = 0xDA3b641D438362C440Ac5458c57e00a712b66700;
    bytes32 constant OFFICIAL_KEY_HASH_50GWEI = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;

    struct Deployed {
        address agentId;
        address vrf;
        address timelock;
        address drawV2;
        address launch;
        address rebates;
        address team;
        address token;
        address router;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address teamWallet = vm.envOr("TEAM_WALLET", deployer);
        address seasons = vm.envOr("SEASONS_WALLET", deployer);
        address ecosystem = vm.envOr("ECOSYSTEM_WALLET", deployer);
        address pol = vm.envOr("POL_WALLET", deployer);
        address dev = vm.envOr("DEV_WALLET", deployer);
        uint256 mintDuration = vm.envOr("MINT_DURATION", uint256(3 days));
        uint256 tlDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));

        vm.startBroadcast(pk);

        d.agentId = vm.envOr("AGENT_ID", address(0));
        if (d.agentId == address(0)) d.agentId = address(new MockAgentId());

        // Official Chainlink VRF v2.5 only (no mock fallback). The subscription must exist and be owned by
        // the deployer so the consumers can be added below.
        d.vrf = vm.envOr("VRF_COORDINATOR", OFFICIAL_VRF_COORDINATOR);
        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig({
            coordinator: d.vrf,
            keyHash: vm.envOr("VRF_KEY_HASH", OFFICIAL_KEY_HASH_50GWEI),
            subId: vm.envUint("VRF_SUB_ID"),
            requestConfirmations: 3,
            callbackGasLimit: uint32(vm.envOr("VRF_CALLBACK_GAS", uint256(250_000))),
            nativePayment: vm.envOr("VRF_NATIVE", true)
        });

        address[] memory admins = new address[](1);
        admins[0] = deployer;
        d.timelock = address(new TimelockController(tlDelay, admins, admins, address(0)));

        d.drawV2 = address(new DrawV2(d.timelock, address(0), cfg));
        d.launch =
            address(new TowackLaunch(d.agentId, WBNB, d.drawV2, block.timestamp, block.timestamp + mintDuration, cfg));
        d.rebates = address(new RebateDistributor());
        d.team = address(new TeamVesting(teamWallet));

        d.token = address(
            new TowackToken(
                TowackToken.Recipients({
                    launch: d.launch,
                    rebates: d.rebates,
                    team: d.team,
                    drawV2: d.drawV2,
                    seasons: seasons,
                    ecosystem: ecosystem,
                    polBuffer: pol
                }),
                PANCAKE_FACTORY,
                WBNB
            )
        );
        TowackLaunch(payable(d.launch)).bindToken(d.token);
        TeamVesting(d.team).bindToken(d.token);
        DrawV2(payable(d.drawV2)).bindToken(d.token);

        d.router = address(new TowackRouter(d.token, PANCAKE_ROUTER, d.agentId, d.rebates, d.drawV2, dev));
        RebateDistributor(payable(d.rebates)).bind(d.token, d.router);
        IVRFCoordinatorV2Plus(d.vrf).addConsumer(cfg.subId, d.drawV2);
        IVRFCoordinatorV2Plus(d.vrf).addConsumer(cfg.subId, d.launch);

        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("AgentId", d.agentId);
        console2.log("VRFCoordinator", d.vrf);
        console2.log("Timelock", d.timelock);
        console2.log("DrawV2", d.drawV2);
        console2.log("TowackLaunch", d.launch);
        console2.log("RebateDistributor", d.rebates);
        console2.log("TeamVesting", d.team);
        console2.log("TowackToken", d.token);
        console2.log("TWAK/WBNB pair", TowackToken(d.token).pair());
        console2.log("TowackRouter", d.router);
    }
}
