// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentDeals} from "../src/AgentDeals.sol";

interface IHandleRegistry {
    function balanceOf(address) external view returns (uint256);
}

interface ITokenLike {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Deploys AgentDeals (Agent Exchange escrow) to BSC mainnet, wired to the live Towack stack.
///
///   Fee treasury = the Towack ecosystem wallet (chosen by the owner). Draw V2 gets 0.2% of TWAK deals via seed().
///   AgentDeals has no owner: everything below is fixed forever once deployed.
///
/// Keyless simulation (safe, nothing sent):
///   forge script script/DeployAgentDeals.s.sol --sig "dryRun()" --rpc-url https://bsc-dataseed.bnbchain.org
/// Broadcast (owner only; any funded wallet can deploy, it gets no privileges):
///   TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO PRIVATE_KEY=... forge script script/DeployAgentDeals.s.sol \
///     --rpc-url https://bsc-dataseed.bnbchain.org --broadcast --slow --legacy --with-gas-price 0.1gwei
contract DeployAgentDeals is Script {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F; // SPACE ID HandleRegistry
    address constant TWAK = 0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD (18 decimals)
    address constant DRAW_V2 = 0xdf4499f5690474F502a774eCF6B93E73f57944C8;
    address constant TREASURY = 0x38A0f77Dad60B34cF5cD39305687e354696a6776; // Towack ecosystem wallet
    string constant GO_PHRASE = "I_HAVE_MATEENS_GO";

    function dryRun() external returns (address deals) {
        _preflight();
        vm.startBroadcast(TREASURY); // simulated sender only
        deals = address(new AgentDeals(AGENT_ID, TWAK, USDT, TREASURY, DRAW_V2));
        vm.stopBroadcast();
        _summary(deals);
        console2.log("DRY RUN ONLY: the address above is simulated; nothing was sent");
    }

    function run() external returns (address deals) {
        require(block.chainid == 56, "BSC mainnet only");
        require(
            keccak256(bytes(vm.envOr("TOWACK_MAINNET_GO", string("")))) == keccak256(bytes(GO_PHRASE)),
            "mainnet broadcast blocked: set TOWACK_MAINNET_GO only after the owner says go"
        );
        uint256 pk = vm.envUint("PRIVATE_KEY");
        _preflight();
        vm.startBroadcast(pk);
        deals = address(new AgentDeals(AGENT_ID, TWAK, USDT, TREASURY, DRAW_V2));
        vm.stopBroadcast();
        _summary(deals);
    }

    function _preflight() internal view {
        require(block.chainid == 56, "BSC mainnet (or a mainnet fork) only");
        require(
            AGENT_ID.code.length > 0 && TWAK.code.length > 0 && USDT.code.length > 0 && DRAW_V2.code.length > 0,
            "missing code"
        );
        require(keccak256(bytes(ITokenLike(TWAK).symbol())) == keccak256("TWAK"), "TWAK symbol");
        require(ITokenLike(USDT).decimals() == 18, "USDT decimals");
        require(IHandleRegistry(AGENT_ID).balanceOf(address(0xdead)) == 0, "registry sanity");
    }

    function _summary(address deals) internal view {
        AgentDeals d = AgentDeals(deals);
        console2.log("AgentDeals:", deals);
        console2.log("  treasury:", d.treasury());
        console2.log("  drawV2:  ", d.drawV2());
        console2.log("  twak:    ", address(d.twak()));
        console2.log("  usdt:    ", address(d.usdt()));
        console2.log("  fee bps: ", d.FEE_BPS(), "draw bps:", d.DRAW_FEE_BPS());
    }
}
