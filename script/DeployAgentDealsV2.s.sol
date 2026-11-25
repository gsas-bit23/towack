// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentDealsV2} from "../src/AgentDealsV2.sol";

interface IHandleRegistryV2 {
    function balanceOf(address) external view returns (uint256);
}

interface ITokenLikeV2 {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Deploys AgentDealsV2 (escrow + open Agent ID judge juries) to BSC mainnet, wired to the live Towack stack.
/// Same wiring as AgentDeals v1: fee treasury = Towack ecosystem wallet, Draw V2 gets 0.2% of TWAK deals.
/// No owner: everything is fixed forever once deployed.
///
/// Keyless simulation (nothing sent):
///   forge script script/DeployAgentDealsV2.s.sol --sig "dryRun()" --rpc-url https://bsc-dataseed.bnbchain.org
/// Live deploys go through the CREATE2 deployer with a Binance Agentic Wallet contract-call
/// (calldata = salt ++ initcode, see `create2Calldata()`), or with a key:
///   TOWACK_MAINNET_GO=I_HAVE_MATEENS_GO PRIVATE_KEY=... forge script script/DeployAgentDealsV2.s.sol \
///     --rpc-url https://bsc-dataseed.bnbchain.org --broadcast --slow --legacy --with-gas-price 0.1gwei
contract DeployAgentDealsV2 is Script {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F; // SPACE ID HandleRegistry
    address constant TWAK = 0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD (18 decimals)
    address constant DRAW_V2 = 0xdf4499f5690474F502a774eCF6B93E73f57944C8;
    address constant TREASURY = 0x38A0f77Dad60B34cF5cD39305687e354696a6776; // Towack ecosystem wallet
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 constant SALT = keccak256("towack.agentdeals.v2");
    string constant GO_PHRASE = "I_HAVE_MATEENS_GO";

    function initcode() public pure returns (bytes memory) {
        return abi.encodePacked(type(AgentDealsV2).creationCode, abi.encode(AGENT_ID, TWAK, USDT, TREASURY, DRAW_V2));
    }

    /// Calldata for the CREATE2 deployer (salt ++ initcode) and the address it will create.
    function create2Calldata() external view returns (bytes memory data, address predicted) {
        bytes memory code = initcode();
        data = abi.encodePacked(SALT, code);
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, SALT, keccak256(code)))))
        );
        console2.log("predicted AgentDealsV2:", predicted);
        console2.log("calldata bytes:", data.length);
    }

    function dryRun() external returns (address deals) {
        _preflight();
        vm.startBroadcast(TREASURY); // simulated sender only
        deals = address(new AgentDealsV2(AGENT_ID, TWAK, USDT, TREASURY, DRAW_V2));
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
        deals = address(new AgentDealsV2(AGENT_ID, TWAK, USDT, TREASURY, DRAW_V2));
        vm.stopBroadcast();
        _summary(deals);
    }

    function _preflight() internal view {
        require(block.chainid == 56, "BSC mainnet (or a mainnet fork) only");
        require(
            AGENT_ID.code.length > 0 && TWAK.code.length > 0 && USDT.code.length > 0 && DRAW_V2.code.length > 0,
            "missing code"
        );
        require(keccak256(bytes(ITokenLikeV2(TWAK).symbol())) == keccak256("TWAK"), "TWAK symbol");
        require(ITokenLikeV2(USDT).decimals() == 18, "USDT decimals");
        require(IHandleRegistryV2(AGENT_ID).balanceOf(address(0xdead)) == 0, "registry sanity");
    }

    function _summary(address deals) internal view {
        AgentDealsV2 d = AgentDealsV2(deals);
        console2.log("AgentDealsV2:", deals);
        console2.log("  treasury:", d.treasury());
        console2.log("  drawV2:  ", d.drawV2());
        console2.log("  twak:    ", address(d.twak()));
        console2.log("  usdt:    ", address(d.usdt()));
        console2.log("  fee bps: ", d.FEE_BPS(), "judge bps:", d.JUDGE_FEE_BPS());
    }
}
