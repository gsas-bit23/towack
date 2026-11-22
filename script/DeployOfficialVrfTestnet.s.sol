// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";
import {IVRFCoordinatorV2Plus} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Moves Genesis 300 and the DrawV2 pool wheel to the OFFICIAL
/// Chainlink VRF v2.5 coordinator with ONE native-payment (tBNB) subscription. Launch / Token / Router stay
/// on the old MockVRFCoordinator (Launch is ownerless and holds 650M TWAK; full redeploy not approved).
///
/// Two broadcasts, because `createSubscription()` derives the subId from `blockhash(block.number - 1)`, so a
/// subId produced during forge's local simulation is NOT the on-chain one:
///
///   # 1) create the subscription (one tx), then read the subId from the SubscriptionCreated log
///   forge script script/DeployOfficialVrfTestnet.s.sol --sig "createSub()" --rpc-url bsc_testnet \
///     --broadcast --legacy --with-gas-price 1gwei --slow
///   # 2) fund it, deploy + wire the consumers, close/sweep the old Genesis
///   VRF_SUB_ID=<subId> forge script script/DeployOfficialVrfTestnet.s.sol --rpc-url bsc_testnet \
///     --broadcast --legacy --with-gas-price 1gwei --slow
///
/// Key: env PRIVATE_KEY only (never logged). Gas/cost preview without any key:
///   forge script script/DeployOfficialVrfTestnet.s.sol --sig "dryRun()" --rpc-url bsc_testnet \
///     --legacy --with-gas-price 1gwei            # simulation only, NEVER pass --broadcast
///
/// Env (step 2): VRF_SUB_ID (required), VRF_NATIVE_FUND (wei, default 0.045 tBNB), GAS_RESERVE (wei, default
/// 0.015 tBNB), VRF_CALLBACK_GAS (default 250k), GENESIS_REGISTER_NEW_ID (default true),
/// OLD_GENESIS_SWEEP (default true).
contract DeployOfficialVrfTestnet is Script {
    // ---- official Chainlink VRF v2.5, BNB Chain testnet (subscription, native payment)
    address constant VRF_COORDINATOR = 0xDA3b641D438362C440Ac5458c57e00a712b66700;
    bytes32 constant KEY_HASH_50GWEI = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    uint16 constant CONFIRMATIONS = 3;

    // ---- existing testnet stack
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    address constant TOKEN = 0xD2A3eDD943d442af41e61c699F77e7E63ACff7dD;
    address constant TIMELOCK = 0x66F42673E3d31Dd90eE3fDEdb75012F0d02A1d0e;
    address constant AGENT_ID_NFT = 0x70BC7133E62427DAE709299454ed8c9015898036;
    address constant OLD_GENESIS = 0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78; // mock VRF, 1 mint
    address constant OLD_DRAW_V2 = 0x66E84a08f770a137a0F1263881d0E12279450191; // mock VRF, 5M locked (no withdraw)
    address constant DRAW_V2_SKELETON = 0x5B3028454a628F73A5fe9198DE4fddefCC43c73A; // 70M + Launch BNB
    address constant LAUNCH_MOCK_VRF = 0x37720d1a42E483fB36d09bc93596a2feF535FF8b; // stays on mock VRF
    address constant OLD_MOCK_VRF = 0x09d282Fc69840BcF4047b89F884738f041f53F61;

    uint256 constant GENESIS_BUDGET = 8_000_000e18;
    uint256 constant DRAW_V2_SEED = 5_000_000e18;

    struct Out {
        uint256 subId;
        uint256 fund;
        address genesis;
        address drawV2;
        uint256 agentTokenId;
        uint256 oldGenesisSwept;
    }

    // ================================================================ step 1
    function createSub() external returns (uint256 subId) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "unexpected deployer");
        vm.startBroadcast(pk);
        subId = IVRFCoordinatorV2Plus(VRF_COORDINATOR).createSubscription();
        vm.stopBroadcast();
        console2.log("coordinator", VRF_COORDINATOR);
        console2.log("owner", DEPLOYER);
        console2.log("SIMULATED subId (NOT final; read SubscriptionCreated topic1 from the receipt):", subId);
    }

    // ================================================================ step 2
    function run() external returns (Out memory o) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "unexpected deployer");
        o.subId = vm.envUint("VRF_SUB_ID");
        (,,, address subOwner,) = IVRFCoordinatorV2Plus(VRF_COORDINATOR).getSubscription(o.subId);
        require(subOwner == DEPLOYER, "sub not owned by deployer");
        vm.startBroadcast(pk);
        o = _deploy(o.subId);
        vm.stopBroadcast();
        _log(o);
    }

    /// Full simulation (sub + fund + deploys + wiring) as the deployer address, no key. Never broadcast.
    function dryRun() external returns (Out memory o) {
        require(block.chainid == 97, "BSC testnet only");
        vm.startBroadcast(DEPLOYER);
        uint256 subId = IVRFCoordinatorV2Plus(VRF_COORDINATOR).createSubscription();
        o = _deploy(subId);
        vm.stopBroadcast();
        _log(o);
        console2.log("DRY RUN ONLY: subId above is simulated");
    }

    function _deploy(uint256 subId) internal returns (Out memory o) {
        o.subId = subId;
        o.fund = vm.envOr("VRF_NATIVE_FUND", uint256(0.045 ether));
        uint256 reserve = vm.envOr("GAS_RESERVE", uint256(0.015 ether));
        uint32 cbGas = uint32(vm.envOr("VRF_CALLBACK_GAS", uint256(250_000)));
        IERC20 twak = IERC20(TOKEN);
        IVRFCoordinatorV2Plus coord = IVRFCoordinatorV2Plus(VRF_COORDINATOR);

        // ---- prechecks (tBNB: fund + gas reserve; TWAK: 8M Genesis + 5M pool)
        require(DEPLOYER.balance >= o.fund + reserve, "deployer tBNB < VRF_NATIVE_FUND + GAS_RESERVE");
        require(twak.balanceOf(DEPLOYER) >= GENESIS_BUDGET + DRAW_V2_SEED, "deployer TWAK < 13M");

        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig({
            coordinator: VRF_COORDINATOR,
            keyHash: KEY_HASH_50GWEI,
            subId: subId,
            requestConfirmations: CONFIRMATIONS,
            callbackGasLimit: cbGas,
            nativePayment: true,
            minFeeGasPrice: 1 gwei,
            maxFeeGasPrice: 50 gwei
        });

        // ---- subscription funding (tBNB goes to the coordinator, credited to this subId)
        coord.fundSubscriptionWithNative{value: o.fund}(subId);

        // ---- old Genesis (mock VRF): stop new mints, return surplus to the ecosystem wallet (= deployer)
        TowackGenesis oldG = TowackGenesis(OLD_GENESIS);
        if (oldG.isOpen()) oldG.close();
        if (vm.envOr("OLD_GENESIS_SWEEP", true) && oldG.surplus() > 0) {
            o.oldGenesisSwept = oldG.sweepSurplus();
        }

        // ---- new Genesis on official VRF (owner = deployer, sweep target = deployer as before)
        TowackGenesis g = new TowackGenesis(TOKEN, AGENT_ID_NFT, DEPLOYER, DEPLOYER, cfg);
        coord.addConsumer(subId, address(g));
        twak.approve(address(g), GENESIS_BUDGET);
        g.fund(GENESIS_BUDGET);
        g.open();
        o.genesis = address(g);

        // ---- new DrawV2 pool on official VRF (owner = timelock, stand-alone, 5M testnet seed)
        DrawV2 d = new DrawV2(TIMELOCK, TOKEN, cfg);
        coord.addConsumer(subId, address(d));
        twak.approve(address(d), DRAW_V2_SEED);
        d.seed(DRAW_V2_SEED);
        o.drawV2 = address(d);

        // ---- fresh Agent ID token for the deployer's real-VRF Genesis mint (id 1 was used on the old Genesis)
        if (vm.envOr("GENESIS_REGISTER_NEW_ID", true)) {
            o.agentTokenId = MockAgentIdNFT(AGENT_ID_NFT).registerFor(DEPLOYER);
        }
    }

    function _log(Out memory o) internal view {
        (, uint96 nb,, address owner, address[] memory cons) =
            IVRFCoordinatorV2Plus(VRF_COORDINATOR).getSubscription(o.subId);
        console2.log("== official Chainlink VRF v2.5 (BSC testnet)");
        console2.log("coordinator", VRF_COORDINATOR);
        console2.log("keyHash (50 gwei lane)");
        console2.logBytes32(KEY_HASH_50GWEI);
        console2.log("subId", o.subId);
        console2.log("sub owner", owner);
        console2.log("sub native funded (wei)", o.fund);
        console2.log("sub native balance (wei)", uint256(nb));
        console2.log("sub consumers", cons.length);
        console2.log("== new consumers");
        console2.log("TowackGenesis (official VRF)", o.genesis);
        console2.log("DrawV2 pool (official VRF)", o.drawV2);
        console2.log("new Agent ID token id for deployer", o.agentTokenId);
        console2.log("== old (mock VRF)");
        console2.log("old Genesis (closed)", OLD_GENESIS);
        console2.log("old Genesis surplus swept to deployer (wei TWAK)", o.oldGenesisSwept);
        console2.log("old DrawV2 pool (5M+ locked, no withdraw)", OLD_DRAW_V2);
        console2.log("DrawV2 skeleton (70M, Launch treasury)", DRAW_V2_SKELETON);
        console2.log("TowackLaunch (stays on mock VRF)", LAUNCH_MOCK_VRF);
        console2.log("MockVRFCoordinator (Launch only)", OLD_MOCK_VRF);
        console2.log("deployer tBNB left (wei)", DEPLOYER.balance);
    }
}
