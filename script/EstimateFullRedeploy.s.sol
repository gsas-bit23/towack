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

/// @notice COST ESTIMATE ONLY for a FULL STACK redeploy on the Chainlink VRF v2.5 direct-funding WRAPPER
/// (native, user-paid per request). Keyless: it simulates as the deployer ADDRESS (`vm.startBroadcast(address)`),
/// never reads a key, and REFUSES to run under `--broadcast` / `--resume` on every chain, mainnet included (hard
/// `require` on the forge context).
///
///   # BSC testnet (97)
///   forge script script/EstimateFullRedeploy.s.sol --rpc-url bsc_testnet \
///     --legacy --with-gas-price 1gwei --gas-estimate-multiplier 100
///   # BSC mainnet (56): fork simulation, NO key, NEVER --broadcast
///   forge script script/EstimateFullRedeploy.s.sol --fork-url https://bsc-dataseed.bnbchain.org \
///     --legacy --with-gas-price <live wei> --gas-estimate-multiplier 100
///
/// Txs (same order as DeployFullStackTestnet): Timelock, DrawV2 (70M via TokenBound), Launch, RebateDistributor,
/// TeamVesting, Token (+pair), 3x bindToken, Router, rebates.bind, Genesis, approve + fund(8M) + open.
/// No subscription and NO VRF deposit: the wrapper is paid per request by users. No paid mint (a user cost).
/// The script measures the gas of each step in-simulation and prints the deploy cost at the run's gas price,
/// 0.05, 0.1, 1 and 3 gwei. forge's own "Estimated total gas" summary is the authoritative number.
/// Env: VRF_WRAPPER (default: official wrapper, same address on 97 and 56), AGENT_ID / AGENT_ID_NFT (mainnet
/// registries; default placeholders, gas is identical).
contract EstimateFullRedeploy is Script {
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;
    /// Official VRFV2PlusWrapper on BSC testnet AND mainnet (docs.chain.link/vrf/v2-5/supported-networks).
    address constant OFFICIAL_VRF_WRAPPER = 0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94;

    // per-contract callback gas limits (see docs/ARCHITECTURE.md, Randomness)
    uint32 constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 constant DRAW_CALLBACK_GAS = 200_000;
    uint256 constant GENESIS_BUDGET = 8_000_000e18;

    struct Net {
        address wrapper;
        address pancakeFactory;
        address pancakeRouter;
        address wbnb;
        address agentId; // balance-gated registry (Launch, Router)
        address agentIdNft; // ERC-721 registry (Genesis)
    }

    struct Out {
        uint256 gasUsed; // in-simulation execution gas of all deploy steps (excl. intrinsic / calldata)
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
        n.wrapper = vm.envOr("VRF_WRAPPER", OFFICIAL_VRF_WRAPPER);
        if (block.chainid == 97) {
            n.pancakeFactory = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
            n.pancakeRouter = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
            n.wbnb = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
            n.agentId = vm.envOr("AGENT_ID", address(0xfF5f224349e6aDB7754249d5e4352dB0910717B7));
            n.agentIdNft = vm.envOr("AGENT_ID_NFT", address(0x70BC7133E62427DAE709299454ed8c9015898036));
        } else if (block.chainid == 56) {
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
        require(n.wrapper.code.length > 0, "no VRF wrapper code on this chain");
        console2.log("chainid", block.chainid);
        console2.log("VRF wrapper", n.wrapper);
        // Simulation only: make sure the simulated deployer can pay gas (no real funds move).
        if (DEPLOYER.balance < 1 ether) vm.deal(DEPLOYER, 1 ether);

        uint256 g0 = gasleft();
        vm.startBroadcast(DEPLOYER);
        address[] memory admins = new address[](1);
        admins[0] = DEPLOYER;
        o.timelock = address(new TimelockController(48 hours, admins, admins, address(0)));
        o.drawV2 = address(new DrawV2(o.timelock, address(0), _cfg(n, DRAW_CALLBACK_GAS)));
        o.launch = address(
            new TowackLaunch(
                n.agentId, n.wbnb, o.drawV2, block.timestamp, block.timestamp + 3 days, _cfg(n, LAUNCH_CALLBACK_GAS)
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
            new TowackGenesis(o.token, n.agentIdNft, DEPLOYER, DEPLOYER, _cfg(n, GENESIS_CALLBACK_GAS))
        );
        TowackToken(o.token).approve(o.genesis, GENESIS_BUDGET);
        TowackGenesis(o.genesis).fund(GENESIS_BUDGET);
        TowackGenesis(o.genesis).open();
        vm.stopBroadcast();
        o.gasUsed = g0 - gasleft();

        // ---- deploy cost (gas only; no VRF deposit exists on the wrapper model)
        uint256 gp = tx.gasprice;
        console2.log("in-simulation deploy execution gas (excl. 21k/tx intrinsic + calldata)", o.gasUsed);
        console2.log("  -> use forge's 'Estimated total gas used' summary as the authoritative total");
        console2.log("tx.gasprice used for the run (wei)", gp);
        console2.log("  deploy BNB-wei @ run gas price", o.gasUsed * gp);
        console2.log("  deploy BNB-wei @ 0.05 gwei", o.gasUsed * 0.05 gwei);
        console2.log("  deploy BNB-wei @ 0.1 gwei", o.gasUsed * 0.1 gwei);
        console2.log("  deploy BNB-wei @ 1 gwei", o.gasUsed * 1 gwei);
        console2.log("  deploy BNB-wei @ 3 gwei", o.gasUsed * 3 gwei);
        console2.log("VRF deposit: none (direct-funding wrapper, users pay each request)");

        // ---- per-request user fees with these limits (the frontend calls vrfFeeAt(gasPrice) the same way)
        _fees("Launch", VRFConsumerV25(o.launch), gp);
        _fees("Genesis", VRFConsumerV25(o.genesis), gp);
        _fees("DrawV2", VRFConsumerV25(o.drawV2), gp);
        console2.log("DrawV2 availableTwak", DrawV2(payable(o.drawV2)).availableTwak());
        console2.log("Genesis committed", TowackGenesis(o.genesis).committed());
        console2.log("ESTIMATE ONLY - nothing was broadcast; addresses are simulated");
    }

    function _cfg(Net memory n, uint32 gasLimit) internal pure returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({wrapper: n.wrapper, requestConfirmations: 3, callbackGasLimit: gasLimit});
    }

    function _fees(string memory name, VRFConsumerV25 c, uint256 gp) internal view {
        IVRFV2PlusWrapper w = c.vrfWrapper();
        uint32 lim = c.vrfCallbackGasLimit();
        console2.log(name, "callbackGasLimit", lim);
        console2.log("  wrapper price @ run gas price wei", w.estimateRequestPriceNative(lim, 1, gp));
        console2.log("  wrapper price @ 0.1 gwei wei", w.estimateRequestPriceNative(lim, 1, 0.1 gwei));
        console2.log("  wrapper price @ 1 gwei wei", w.estimateRequestPriceNative(lim, 1, 1 gwei));
        console2.log("  UI quote vrfFeeAt(1 gwei) wei (+10%, excess refunded)", c.vrfFeeAt(1 gwei));
    }
}
