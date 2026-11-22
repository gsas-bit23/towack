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
import {IVRFCoordinatorV2Plus} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice COST ESTIMATE ONLY for a future FULL STACK redeploy with user-paid Chainlink VRF fees.
/// Keyless: it simulates as the deployer ADDRESS (`vm.startBroadcast(address)`), never reads a key, and
/// REFUSES to run under `--broadcast` / `--resume` on every chain (hard `require` on the forge context).
///
///   # BSC testnet (97)
///   forge script script/EstimateFullRedeploy.s.sol --rpc-url bsc_testnet \
///     --legacy --with-gas-price 1gwei --gas-estimate-multiplier 100
///   # BSC mainnet (56): fork simulation, NO key, NEVER --broadcast
///   forge script script/EstimateFullRedeploy.s.sol --fork-url https://bsc-dataseed.bnbchain.org \
///     --legacy --with-gas-price <live wei> --gas-estimate-multiplier 100
///
/// Txs (same order a real redeploy would use): createSubscription, fundSubscriptionWithNative(reserve),
/// Timelock, DrawV2 (70M via TokenBound), Launch, RebateDistributor, TeamVesting, Token (+pair), 3x bindToken,
/// Router, rebates.bind, Genesis, approve + fund(8M) + open, addConsumer x3. No paid mint (that is a user cost).
///
/// Sub pre-fund = Chainlink's off-chain "minimum subscription balance" for ONE pending request of the largest
/// consumer: laneMax * (200,000 max verification gas + callbackGasLimit) * (100 + premium) / 100. Below it the
/// node leaves requests pending (24h expiry). Users' per-request fees are added on top, so this is a
/// refundable operating deposit (cancelSubscription returns it), not a per-request cost.
/// Env: REUSE_SUB_ID (testnet: reuse an existing deployer-owned, already-funded sub -> no create/fund tx),
/// AGENT_ID / AGENT_ID_NFT (mainnet registries; default placeholders, gas is identical).
contract EstimateFullRedeploy is Script {
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;

    // per-contract callback gas limits (measured worst case incl. mock overhead: 131,772 / 135,600 / 158,463)
    uint32 constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 constant DRAW_CALLBACK_GAS = 200_000;
    uint256 constant MAX_VERIFICATION_GAS = 200_000; // Chainlink docs, minimum-balance formula
    uint256 constant GENESIS_BUDGET = 8_000_000e18;

    struct Net {
        address coordinator;
        bytes32 keyHash;
        uint64 laneMaxGasPrice;
        uint64 minFeeGasPrice; // gas price the Chainlink node actually fulfils at
        address pancakeFactory;
        address pancakeRouter;
        address wbnb;
        address agentId; // balance-gated registry (Launch, Router)
        address agentIdNft; // ERC-721 registry (Genesis)
    }

    struct Out {
        uint256 subId;
        uint256 reserve;
        address timelock;
        address drawV2;
        address launch;
        address rebates;
        address team;
        address token;
        address router;
        address genesis;
    }

    function _net() internal view returns (Net memory n) {
        if (block.chainid == 97) {
            n.coordinator = 0xDA3b641D438362C440Ac5458c57e00a712b66700;
            n.keyHash = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26; // 50 gwei lane
            n.laneMaxGasPrice = 50 gwei;
            n.minFeeGasPrice = 1 gwei; // observed fulfilments on 97 (2026-11-22) at 1 gwei
            n.pancakeFactory = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
            n.pancakeRouter = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
            n.wbnb = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
            n.agentId = vm.envOr("AGENT_ID", address(0xfF5f224349e6aDB7754249d5e4352dB0910717B7));
            n.agentIdNft = vm.envOr("AGENT_ID_NFT", address(0x70BC7133E62427DAE709299454ed8c9015898036));
        } else if (block.chainid == 56) {
            n.coordinator = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
            n.keyHash = 0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4; // 200 gwei lane
            n.laneMaxGasPrice = 200 gwei;
            n.minFeeGasPrice = 0.1 gwei; // observed mainnet VRF fulfilments (2026-11-22) at 0.1 gwei
            n.pancakeFactory = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
            n.pancakeRouter = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
            n.wbnb = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
            // Real Agent ID registries are not decided yet: placeholders (constructors only check != 0).
            n.agentId = vm.envOr("AGENT_ID", address(uint160(0xA9E1)));
            n.agentIdNft = vm.envOr("AGENT_ID_NFT", address(uint160(0xA9E2)));
        } else {
            revert("chain 97 or 56 only");
        }
    }

    function run() external returns (Out memory o) {
        // ---- estimate only: never send anything, on any chain
        require(
            !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
            "ESTIMATE ONLY: refusing --broadcast/--resume"
        );
        Net memory n = _net();
        IVRFCoordinatorV2Plus coord = IVRFCoordinatorV2Plus(n.coordinator);

        (,,,, uint32 gasAfter, uint32 flatPPM,, uint8 premium,) = ICoordinatorConfig(n.coordinator).s_config();
        console2.log("chainid", block.chainid);
        console2.log("s_config premium % / gasAfterPayment / flatPPM", premium, gasAfter, flatPPM);

        o.reserve = uint256(n.laneMaxGasPrice) * (MAX_VERIFICATION_GAS + DRAW_CALLBACK_GAS) * (100 + premium) / 100;
        uint256 reuse = vm.envOr("REUSE_SUB_ID", uint256(0));
        // Simulation only: make sure the simulated deployer can cover the deposit (no real funds move).
        if (DEPLOYER.balance < o.reserve + 1 ether) vm.deal(DEPLOYER, o.reserve + 1 ether);

        vm.startBroadcast(DEPLOYER);
        if (reuse != 0) {
            o.subId = reuse;
            o.reserve = 0;
        } else {
            o.subId = coord.createSubscription();
            coord.fundSubscriptionWithNative{value: o.reserve}(o.subId);
        }

        address[] memory admins = new address[](1);
        admins[0] = DEPLOYER;
        o.timelock = address(new TimelockController(48 hours, admins, admins, address(0)));
        o.drawV2 = address(new DrawV2(o.timelock, address(0), _cfg(n, o.subId, DRAW_CALLBACK_GAS)));
        o.launch = address(
            new TowackLaunch(
                n.agentId, n.wbnb, o.drawV2, block.timestamp, block.timestamp + 3 days, _cfg(n, o.subId, LAUNCH_CALLBACK_GAS)
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
                    drawV2: o.drawV2, // 70M PRIZE_ALLOCATION minted straight into the new pool
                    seasons: DEPLOYER,
                    ecosystem: DEPLOYER,
                    polBuffer: DEPLOYER
                }),
                n.pancakeFactory,
                n.wbnb
            )
        );
        TowackLaunch(payable(o.launch)).bindToken(o.token);
        TeamVesting(o.team).bindToken(o.token);
        DrawV2(payable(o.drawV2)).bindToken(o.token);
        o.router = address(new TowackRouter(o.token, n.pancakeRouter, n.agentId, o.rebates, o.drawV2, DEPLOYER));
        RebateDistributor(payable(o.rebates)).bind(o.token, o.router);

        o.genesis = address(
            new TowackGenesis(o.token, n.agentIdNft, DEPLOYER, DEPLOYER, _cfg(n, o.subId, GENESIS_CALLBACK_GAS))
        );
        TowackToken(o.token).approve(o.genesis, GENESIS_BUDGET);
        TowackGenesis(o.genesis).fund(GENESIS_BUDGET);
        TowackGenesis(o.genesis).open();

        coord.addConsumer(o.subId, o.launch);
        coord.addConsumer(o.subId, o.genesis);
        coord.addConsumer(o.subId, o.drawV2);
        vm.stopBroadcast();

        // ---- per-request user fees with these limits (frontend calls vrfFeeAt(gasPrice) the same way)
        uint256 gp = tx.gasprice;
        console2.log("tx.gasprice used for the run (wei)", gp);
        _fees("Launch", VRFConsumerV25(o.launch), n, gp);
        _fees("Genesis", VRFConsumerV25(o.genesis), n, gp);
        _fees("DrawV2", VRFConsumerV25(o.drawV2), n, gp);
        console2.log("sub deposit (min balance, 1 DrawV2 request at lane max), wei", o.reserve);
        console2.log("DrawV2 availableTwak", DrawV2(payable(o.drawV2)).availableTwak());
        console2.log("Genesis committed", TowackGenesis(o.genesis).committed());
        console2.log("ESTIMATE ONLY - nothing was broadcast; addresses and subId are simulated");
    }

    function _cfg(Net memory n, uint256 subId, uint32 gasLimit) internal pure returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({
            coordinator: n.coordinator,
            keyHash: n.keyHash,
            subId: subId,
            requestConfirmations: 3,
            callbackGasLimit: gasLimit,
            nativePayment: true,
            minFeeGasPrice: n.minFeeGasPrice,
            maxFeeGasPrice: n.laneMaxGasPrice
        });
    }

    function _fees(string memory name, VRFConsumerV25 c, Net memory n, uint256 gp) internal view {
        console2.log(name, "callbackGasLimit", c.vrfCallbackGasLimit());
        console2.log("  fee @ run gas price (floored) wei", c.vrfFeeAt(gp));
        console2.log("  fee @ node floor wei", c.vrfFeeAt(n.minFeeGasPrice));
        console2.log("  fee @ 1 gwei wei", c.vrfFeeAt(1 gwei));
        console2.log("  fee @ lane max wei", c.vrfFeeAt(n.laneMaxGasPrice));
    }
}

interface ICoordinatorConfig {
    function s_config()
        external
        view
        returns (uint16, uint32, bool, uint32, uint32, uint32, uint32, uint8, uint8);
}
