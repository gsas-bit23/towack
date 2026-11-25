// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentDeals} from "../../src/AgentDeals.sol";
import {IAgentId} from "../../src/interfaces/IAgentId.sol";

/// AgentDeals against LIVE BSC mainnet state: the real SPACE ID Agent ID registry, the live TWAK token, the live
/// DrawV2 pool and real USDT, with two real Agent ID holders as provider and client.
/// Gated behind BSC_MAINNET_FORK=1 so offline `forge test` skips it cleanly.
///   BSC_MAINNET_FORK=1 forge test --match-contract ForkAgentDeals -vv
contract ForkAgentDealsTest is Test {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant TWAK = 0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant DRAW_V2 = 0xdf4499f5690474F502a774eCF6B93E73f57944C8;

    address constant PROVIDER = 0x56a9813E93363fb5141bdDD332f9BBbdC955e2b8; // handle "delben96"
    address constant CLIENT = 0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d; // handle "zeewoo" (Binance Agentic Wallet)
    address treasury = makeAddr("treasury");

    AgentDeals deals;
    uint256 clientId;

    function setUp() public {
        if (!vm.envOr("BSC_MAINNET_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("BSC_MAINNET_RPC", string("https://bsc-rpc.publicnode.com")));
        deals = new AgentDeals(AGENT_ID, TWAK, USDT, treasury, DRAW_V2);
        clientId = uint256(keccak256(bytes(IAgentId(AGENT_ID).handleOf(CLIENT))));
        assertEq(IAgentId(AGENT_ID).ownerOf(clientId), CLIENT, "client handle resolves to its own wallet");
    }

    function test_Fork_TwakDeal_RealAgentIds_SeedsLiveDrawV2() public {
        uint256 amount = 10_000e18;
        deal(TWAK, CLIENT, IERC20(TWAK).balanceOf(CLIENT) + amount);
        uint256 poolBefore = IERC20(TWAK).balanceOf(DRAW_V2);

        vm.prank(PROVIDER);
        uint256 id = deals.createOffer(TWAK, amount, clientId, 1 days, keccak256("fork job"));
        vm.startPrank(CLIENT);
        IERC20(TWAK).approve(address(deals), amount);
        deals.accept(id);
        vm.stopPrank();
        vm.prank(PROVIDER);
        deals.deliver(id, keccak256("done"));
        vm.prank(CLIENT);
        deals.release(id);

        assertEq(IERC20(TWAK).balanceOf(treasury), 80e18);
        assertEq(IERC20(TWAK).balanceOf(DRAW_V2) - poolBefore, 20e18);
        assertEq(IERC20(TWAK).balanceOf(address(deals)), 0);
    }

    function test_Fork_UsdtDeal_RealUsdt() public {
        uint256 amount = 25e18;
        deal(USDT, CLIENT, amount);
        uint256 providerBefore = IERC20(USDT).balanceOf(PROVIDER);

        vm.prank(PROVIDER);
        uint256 id = deals.createOffer(USDT, amount, clientId, 1 days, keccak256("fork job"));
        vm.startPrank(CLIENT);
        IERC20(USDT).approve(address(deals), amount);
        deals.accept(id);
        deals.release(id);
        vm.stopPrank();

        assertEq(IERC20(USDT).balanceOf(PROVIDER) - providerBefore, 24.75e18);
        assertEq(IERC20(USDT).balanceOf(treasury), 0.25e18);
    }

    function test_Fork_NonHolderCannotOffer() public {
        vm.prank(makeAddr("no-agent-id"));
        vm.expectRevert(AgentDeals.NoAgentId.selector);
        deals.createOffer(USDT, 1e18, clientId, 1 days, bytes32(0));
    }
}
