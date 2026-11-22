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
import {IVRFCoordinatorV2Plus} from "../../src/interfaces/IVRFCoordinatorV2Plus.sol";
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
        // The REAL Chainlink VRF v2.5 coordinator on the fork: native sub, consumers added, real requests.
        IVRFCoordinatorV2Plus vrf = IVRFCoordinatorV2Plus(0xDA3b641D438362C440Ac5458c57e00a712b66700);
        uint256 sub = vrf.createSubscription();
        vm.deal(address(this), 1 ether);
        vrf.fundSubscriptionWithNative{value: 0.04 ether}(sub);
        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig(
            address(vrf), 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26, sub, 3, 250_000, true
        );
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
        vrf.addConsumer(sub, address(launch));
        vrf.addConsumer(sub, address(drawV2));
        (, uint96 nb,, address subOwner, address[] memory consumers) = vrf.getSubscription(sub);
        assertEq(nb, 0.04 ether);
        assertEq(subOwner, address(this));
        assertEq(consumers.length, 2);

        for (uint256 i; i < 20; ++i) {
            address u = address(uint160(0xA0000 + i));
            agentId.registerFor(u);
            vm.deal(u, 0.1 ether);
            vm.prank(u);
            launch.mint{value: 0.1 ether}();
        }
        for (uint256 i; i < 20; ++i) {
            (,,,,, uint256 rid) = launch.tickets(address(uint160(0xA0000 + i)));
            uint256[] memory w = new uint256[](1);
            w[0] = uint256(keccak256(abi.encode(777, i)));
            vm.prank(address(vrf)); // the coordinator's own callback path (no node on a fork)
            launch.rawFulfillRandomWords(rid, w);
        }
        assertTrue(vrf.pendingRequestExists(sub), "20 real requests are pending on the coordinator");
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
