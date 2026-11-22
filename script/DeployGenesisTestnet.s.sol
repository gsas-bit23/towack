// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";

/// @notice BSC TESTNET ONLY (chainid 97). Deploys TowackGenesis AND the rewritten DrawV2 instant pool wheel
/// next to the EXISTING testnet contracts (token, MockVRFCoordinator, timelock); it does not redeploy Launch /
/// Token / Router / existing mocks.
///
/// DrawV2: the old skeleton DrawV2 (0x5B30...c73A) keeps the 70M allocation (it has no withdraw) and stays
/// TowackLaunch.drawV2Treasury (immutable), so sellout BNB still lands there. The new DrawV2 is a stand-alone
/// pool (`presetToken_` = TOKEN, owner = TIMELOCK, which can only pause entries) seeded with a TESTNET stand-in
/// of 5,000,000 TWAK from the deployer (= ecosystem wallet). The intended mainnet seed is the 70M allocation.
///
/// Agent ID: Genesis gates on an ERC-721 `ownerOf(tokenId)`. The existing testnet MockAgentId
/// (0xfF5f...17B7) is a soulbound balance-only mock with no token ids, so by default this script deploys a
/// small ERC-721 `MockAgentIdNFT` and registers token id 1 for the deployer. Set GENESIS_AGENT_ID to use an
/// existing ERC-721 registry instead.
///
/// Steps: deploy [MockAgentIdNFT] -> deploy Genesis (owner = deployer) -> approve + fund 8,000,000 TWAK
/// from the deployer (= testnet ecosystem wallet) -> open the window unless GENESIS_OPEN=false
/// -> deploy DrawV2 (owner = timelock) -> approve + seed 5,000,000 TWAK (skip with DRAW_V2_DEPLOY=false).
///
/// Usage (key from env, never logged):
///   set -a; source <deployer env file>; set +a
///   forge script script/DeployGenesisTestnet.s.sol --rpc-url bsc_testnet --broadcast \
///     --legacy --with-gas-price 1gwei --slow
///
/// Optional env: GENESIS_AGENT_ID, GENESIS_OPEN (bool, default true), ECOSYSTEM_WALLET (sweep target,
/// default deployer), VRF_KEY_HASH, VRF_SUB_ID (default 0, as TowackLaunch on testnet),
/// DRAW_V2_DEPLOY (bool, default true).
contract DeployGenesisTestnet is Script {
    address constant TOKEN = 0xD2A3eDD943d442af41e61c699F77e7E63ACff7dD;
    address constant VRF_COORDINATOR = 0x09d282Fc69840BcF4047b89F884738f041f53F61;
    address constant TIMELOCK = 0x66F42673E3d31Dd90eE3fDEdb75012F0d02A1d0e;
    address constant OLD_DRAW_V2 = 0x5B3028454a628F73A5fe9198DE4fddefCC43c73A; // skeleton, holds the 70M
    uint256 constant BUDGET = 8_000_000e18;
    uint256 constant DRAW_V2_SEED = 5_000_000e18; // testnet stand-in for the 70M allocation

    function run() external returns (address genesis, address agentNft, address drawV2) {
        require(block.chainid == 97, "BSC testnet only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address ecosystem = vm.envOr("ECOSYSTEM_WALLET", deployer);
        bool openNow = vm.envOr("GENESIS_OPEN", true);
        agentNft = vm.envOr("GENESIS_AGENT_ID", address(0));
        bool withDraw = vm.envOr("DRAW_V2_DEPLOY", true);

        uint256 need = BUDGET + (withDraw ? DRAW_V2_SEED : 0);
        require(IERC20(TOKEN).balanceOf(deployer) >= need, "deployer lacks 8M (+5M) TWAK");

        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig({
            coordinator: VRF_COORDINATOR,
            keyHash: vm.envOr("VRF_KEY_HASH", bytes32(0)),
            subId: vm.envOr("VRF_SUB_ID", uint256(0)),
            requestConfirmations: 3,
            callbackGasLimit: 300_000,
            nativePayment: false
        });

        vm.startBroadcast(pk);
        if (agentNft == address(0)) {
            MockAgentIdNFT m = new MockAgentIdNFT();
            m.registerFor(deployer); // token id 1
            agentNft = address(m);
        }
        TowackGenesis g = new TowackGenesis(TOKEN, agentNft, ecosystem, deployer, cfg);
        IERC20(TOKEN).approve(address(g), BUDGET);
        g.fund(BUDGET);
        if (openNow) g.open();
        if (withDraw) {
            DrawV2 d = new DrawV2(TIMELOCK, TOKEN, cfg);
            IERC20(TOKEN).approve(address(d), DRAW_V2_SEED);
            d.seed(DRAW_V2_SEED);
            drawV2 = address(d);
        }
        vm.stopBroadcast();
        genesis = address(g);

        console2.log("deployer", deployer);
        console2.log("AgentIdNFT", agentNft);
        console2.log("TowackGenesis", genesis);
        if (withDraw) {
            console2.log("DrawV2 (pool wheel, new)", drawV2);
            console2.log("DrawV2 skeleton (old, keeps 70M + Launch BNB)", OLD_DRAW_V2);
        }
        console2.log("Timelock (future owner, via transferOwnership + acceptOwnership)", TIMELOCK);
    }
}
