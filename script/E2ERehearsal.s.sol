// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @notice BSC-testnet (chain 97) end-to-end rehearsal against the already deployed stack.
/// One step per run, so each on-chain result (VRF outcome) is read before the next step is built:
///   forge script script/E2ERehearsal.s.sol --sig "launchMint()" --rpc-url bsc_testnet --broadcast \
///     --legacy --with-gas-price 1gwei --slow
/// Key comes from env PRIVATE_KEY only. No deploys.
interface ILaunch {
    function mint() external payable;
    function claim() external;
    function tickets(address) external view returns (uint32, uint8, bool, bool, uint64, uint256);
    function prizeOf(address) external view returns (bool, bool, uint8, uint256, uint256, bool);
}

interface IGenesis {
    function mint(uint256 agentTokenId) external;
    function claim() external;
    function tickets(address) external view returns (uint32, uint8, bool, bool, uint64, uint256, uint256);
    function prizeOf(address) external view returns (bool, bool, uint8, uint256, bool);
}

interface IDraw {
    function enter(uint256 amount) external returns (uint256 spinId, uint256 requestId);
    function claim() external;
    function lastSpinOf(address) external view returns (uint256);
    function spins(uint256) external view returns (address, uint8, uint8, uint64, uint256, uint256, uint256, uint256);
    function owedTwak(address) external view returns (uint256);
    function owedBnb(address) external view returns (uint256);
}

interface IMockVRF {
    function fulfillPseudo(uint256 requestId) external;
}

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
}

contract E2ERehearsal is Script {
    ILaunch constant LAUNCH = ILaunch(0x37720d1a42E483fB36d09bc93596a2feF535FF8b);
    IGenesis constant GENESIS = IGenesis(0x8da04F92BC4E3AE985641D960039EE2Ead5F4E78);
    IDraw constant DRAW = IDraw(0x66E84a08f770a137a0F1263881d0E12279450191);
    IMockVRF constant VRF = IMockVRF(0x09d282Fc69840BcF4047b89F884738f041f53F61);
    IERC20Min constant TWAK = IERC20Min(0xD2A3eDD943d442af41e61c699F77e7E63ACff7dD);
    uint256 constant ENTRY = 1000e18;

    function _start() internal {
        require(block.chainid == 97, "chain 97 only");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
    }

    // ------------------------------------------------------------ launch (paid V1)
    function launchMint() external {
        _start();
        LAUNCH.mint{value: 0.1 ether}();
        vm.stopBroadcast();
    }

    function launchFulfill() external {
        (,, bool assigned,,, uint256 rid) = LAUNCH.tickets(msg.sender);
        require(!assigned && rid != 0, "launch: nothing pending");
        console2.log("launch requestId", rid);
        _start();
        VRF.fulfillPseudo(rid);
        vm.stopBroadcast();
    }

    function launchClaim() external {
        _start();
        LAUNCH.claim();
        vm.stopBroadcast();
    }

    // ------------------------------------------------------------ genesis 300
    function genesisMint(uint256 agentTokenId) external {
        _start();
        GENESIS.mint(agentTokenId);
        vm.stopBroadcast();
    }

    function genesisFulfill() external {
        (,, bool assigned,,,, uint256 rid) = GENESIS.tickets(msg.sender);
        require(!assigned && rid != 0, "genesis: nothing pending");
        console2.log("genesis requestId", rid);
        _start();
        VRF.fulfillPseudo(rid);
        vm.stopBroadcast();
    }

    function genesisClaim() external {
        _start();
        GENESIS.claim();
        vm.stopBroadcast();
    }

    // ------------------------------------------------------------ DrawV2 pool wheel
    function drawApprove() external {
        _start();
        TWAK.approve(address(DRAW), ENTRY);
        vm.stopBroadcast();
    }

    function drawEnter() external {
        _start();
        DRAW.enter(ENTRY);
        vm.stopBroadcast();
    }

    function drawFulfill() external {
        uint256 spinId = DRAW.lastSpinOf(msg.sender);
        (, uint8 status,,,,,, uint256 rid) = DRAW.spins(spinId);
        require(status == 1 && rid != 0, "draw: nothing pending");
        console2.log("draw spinId", spinId);
        console2.log("draw requestId", rid);
        _start();
        VRF.fulfillPseudo(rid);
        vm.stopBroadcast();
    }

    function drawClaim() external {
        _start();
        DRAW.claim();
        vm.stopBroadcast();
    }
}
