// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {TowackRouter} from "../src/TowackRouter.sol";
import {RebateDistributor} from "../src/RebateDistributor.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Deploys the OPEN TowackRouter (any wallet can buy/sell; rebates
/// accrue only to Agent ID holders) against the EXISTING wrapper stack, plus a FRESH RebateDistributor that is
/// pointed at the new router via `setRouter`.
///
/// Why a fresh distributor: the live distributor 0x66B70dDF630E721C1416d00A59b5507BC28e117c was bound once to
/// the old router 0xC9aC87b4DFcC7a17eb7D7A104A5e221EB387E9F5 and has no setter, so a new router cannot call
/// `recordFee` on it.
///
/// This script does NOT transfer the 100M TWAK rebate allocation and does NOT call `bind` (token binding needs
/// the exact allocation already held). Funding / binding / retiring the old pair is the operator's decision.
/// A later full-stack redeploy (DeployFullStackTestnet) mints the 100M to a fresh distributor in the token
/// constructor, as today.
///
/// Txs: RebateDistributor, TowackRouter, rebates.setRouter(router).
///
/// Keyless preview + gas estimate (simulation only; NEVER pass --broadcast):
///   forge script script/DeployRouterTestnet.s.sol --sig "dryRun()" \
///     --rpc-url bsc_testnet --legacy --with-gas-price 1gwei
///
/// Broadcast (Grok / the operator only, never by the coding agent):
///   forge script script/DeployRouterTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast --legacy --with-gas-price 1gwei --slow
///
/// Required env (broadcast only): PRIVATE_KEY. Never echo it.
contract DeployRouterTestnet is Script {
    address constant DEPLOYER = 0x38A0f77Dad60B34cF5cD39305687e354696a6776;

    // Existing BSC testnet stack (web/src/config/addresses.json, chain 97).
    address constant TOKEN = 0xbA24050D965991b01d06d10208663E321a5313c8;
    address constant PANCAKE_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1; // official Pancake v2 testnet
    address constant AGENT_ID = 0xfF5f224349e6aDB7754249d5e4352dB0910717B7; // MockAgentId
    address constant DRAW_V2 = 0x59c03c850F49763CC40557C9b3eE8dA2d3527E7e; // lottery treasury (30%)
    address constant DEV = DEPLOYER; // dev / fee recipient (20%), same as the current router

    /// Deploy gas at 1 gwei is ~0.003 tBNB (see dryRun output); keep a margin.
    uint256 constant GAS_RESERVE = 0.006 ether;

    struct Out {
        address rebates;
        address router;
        uint256 gasUsed; // in-simulation execution gas (excl. intrinsic / calldata; forge's summary is authoritative)
    }

    function _guards() internal view {
        require(block.chainid == 97, "BSC testnet only");
        // Belt and braces: never broadcast / resume against mainnet even if the check above is edited.
        if (block.chainid == 56) {
            require(
                !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
                "never broadcast on mainnet"
            );
        }
        require(TOKEN.code.length > 0 && AGENT_ID.code.length > 0 && DRAW_V2.code.length > 0, "stack missing");
        require(PANCAKE_ROUTER.code.length > 0, "pancake missing");
    }

    /// Keyless: simulates as the deployer ADDRESS, never reads a key; refuses --broadcast / --resume.
    function dryRun() external returns (Out memory o) {
        _guards();
        require(
            !vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume),
            "dryRun is simulation only"
        );
        vm.startBroadcast(DEPLOYER);
        o = _deploy();
        vm.stopBroadcast();
        _log(o);
        console2.log("DRY RUN ONLY: addresses above are simulated");
    }

    function run() external returns (Out memory o) {
        _guards();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(vm.addr(pk) == DEPLOYER, "unexpected deployer");
        require(DEPLOYER.balance >= GAS_RESERVE, "deployer tBNB < GAS_RESERVE");
        vm.startBroadcast(pk);
        o = _deploy();
        vm.stopBroadcast();
        _log(o);
    }

    function _deploy() internal returns (Out memory o) {
        uint256 g0 = gasleft();
        RebateDistributor rebates = new RebateDistributor();
        TowackRouter router = new TowackRouter(TOKEN, PANCAKE_ROUTER, AGENT_ID, address(rebates), DRAW_V2, DEV);
        rebates.setRouter(address(router));
        o.gasUsed = g0 - gasleft();
        o.rebates = address(rebates);
        o.router = address(router);
        require(rebates.router() == o.router, "setRouter");
        require(address(rebates.token()) == address(0), "unexpectedly bound");
    }

    function _log(Out memory o) internal view {
        console2.log("== open TowackRouter + fresh RebateDistributor (BSC testnet)");
        console2.log("rebateDistributor", o.rebates);
        console2.log("router", o.router);
        console2.log("rebates.router()", RebateDistributor(payable(o.rebates)).router());
        console2.log("NOT bound: no 100M TWAK moved, bind() not called");
        console2.log("sim exec gas (3 txs, excl. 21k x3 intrinsic + calldata)", o.gasUsed);
        console2.log("  ~wei @ 1 gwei (exec + 63k intrinsic)", (o.gasUsed + 63_000) * 1 gwei);
        console2.log("  tx.gasprice of this run", tx.gasprice);
    }
}
