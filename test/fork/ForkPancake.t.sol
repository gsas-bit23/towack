// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TowackToken} from "../../src/TowackToken.sol";
import {TowackLaunch} from "../../src/TowackLaunch.sol";
import {TowackRouter} from "../../src/TowackRouter.sol";
import {RebateDistributor} from "../../src/RebateDistributor.sol";
import {TeamVesting} from "../../src/TeamVesting.sol";
import {DrawV2} from "../../src/DrawV2.sol";
import {VRFConsumerV25} from "../../src/VRFConsumerV25.sol";
import {MockAgentId} from "../../src/mocks/MockAgentId.sol";
import {MockVRFCoordinator} from "../../src/mocks/MockVRFCoordinator.sol";
import {IPancakePair} from "../../src/interfaces/IPancakeV2.sol";

/// Runs only with BSC_FORK=1 (needs network): full listing + swaps against real PancakeSwap v2 testnet.
///   BSC_FORK=1 forge test --match-contract ForkPancake -vv
contract ForkPancakeTest is Test {
    address constant FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
    address constant ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;

    function test_ForkListingAndSwaps() public {
        if (!vm.envOr("BSC_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("bsc_testnet");

        MockAgentId agentId = new MockAgentId();
        MockVRFCoordinator vrf = new MockVRFCoordinator();
        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig(address(vrf), bytes32(0), 0, 3, 300_000, false);
        DrawV2 drawV2 = new DrawV2(address(this), address(0), cfg);
        TowackLaunch launch =
            new TowackLaunch(address(agentId), WBNB, address(drawV2), block.timestamp, block.timestamp + 1 days, cfg);
        RebateDistributor rebates = new RebateDistributor();
        TeamVesting team = new TeamVesting(address(1));
        TowackToken token = new TowackToken(
            TowackToken.Recipients(
                address(launch), address(rebates), address(team), address(drawV2), address(2), address(3), address(4)
            ),
            FACTORY,
            WBNB
        );
        launch.bindToken(address(token));
        team.bindToken(address(token));
        drawV2.bindToken(address(token));
        TowackRouter router =
            new TowackRouter(address(token), ROUTER, address(agentId), address(rebates), address(drawV2), address(5));
        rebates.bind(address(token), address(router));

        for (uint256 i; i < 20; ++i) {
            address u = address(uint160(0xA0000 + i));
            agentId.registerFor(u);
            vm.deal(u, 0.1 ether);
            vm.prank(u);
            launch.mint{value: 0.1 ether}();
        }
        for (uint256 i; i < 20; ++i) {
            (,,,,, uint256 rid) = launch.tickets(address(uint160(0xA0000 + i)));
            vrf.fulfill(rid, uint256(keccak256(abi.encode(777, i))));
        }
        vm.warp(block.timestamp + 1 days);
        launch.closeMint();
        launch.finalizeListing();

        IPancakePair pair = IPancakePair(token.pair());
        assertGt(pair.totalSupply(), 0);
        assertEq(pair.balanceOf(address(0)), pair.totalSupply(), "all LP burned to address(0)");

        address trader = address(0xBEEF);
        agentId.registerFor(trader);
        vm.deal(trader, 1 ether);
        vm.startPrank(trader);
        uint256 got = router.buy{value: 0.01 ether}(0, block.timestamp);
        assertGt(got, 0);
        token.approve(address(router), got);
        uint256 back = router.sell(got, 0, block.timestamp);
        assertGt(back, 0);
        vm.stopPrank();
        assertEq(token.allowance(address(router), ROUTER), 0);
    }
}
