// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {RebateDistributor} from "../src/RebateDistributor.sol";

contract RebateDistributorTest is Fixture {
    address alice;
    address bob;

    function setUp() public override {
        super.setUp();
        launchWith(1000, 3);
        alice = newAgent("alice");
        bob = newAgent("bob");
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _ep(uint256 e) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = e;
    }

    function test_OnlyRouterRecords() public {
        vm.expectRevert(RebateDistributor.OnlyRouter.selector);
        rebates.recordFee(alice, 1);
    }

    function test_EmissionsSumToAllocation() public view {
        uint256 sum;
        for (uint256 e; e < 110; ++e) {
            sum += rebates.baseEmission(e);
        }
        assertEq(sum, 100_000_000e18);
    }

    function test_ProRataByFeesAndCarry() public {
        // Epoch 0 had no trades before now? Trades happen in the current epoch.
        uint256 e = rebates.currentEpoch();
        vm.prank(alice);
        router.buy{value: 3 ether}(0, block.timestamp);
        vm.prank(bob);
        router.buy{value: 1 ether}(0, block.timestamp);

        vm.expectRevert(abi.encodeWithSelector(RebateDistributor.EpochNotFinished.selector, e));
        vm.prank(alice);
        rebates.claim(_ep(e));

        vm.warp(block.timestamp + 7 days);
        rebates.checkpoint();
        // all base emissions of empty prior epochs [0, e) roll into e
        uint256 expectedBudget;
        for (uint256 i; i <= e; ++i) {
            expectedBudget += rebates.baseEmission(i);
        }
        assertEq(rebates.tokenBudget(e), expectedBudget);
        assertEq(rebates.bnbBudget(e), 0.02 ether);

        (uint256 ta, uint256 ba) = rebates.claimable(alice, e);
        (uint256 tb, uint256 bb) = rebates.claimable(bob, e);
        assertApproxEqAbs(ta, tb * 3, 3);
        assertEq(ba, 0.015 ether);
        assertEq(bb, 0.005 ether);

        uint256 aliceT0 = token.balanceOf(alice);
        uint256 aliceB0 = alice.balance;
        vm.prank(alice);
        rebates.claim(_ep(e));
        assertEq(token.balanceOf(alice) - aliceT0, ta);
        assertEq(alice.balance - aliceB0, ba);
        // second claim pays nothing
        vm.prank(alice);
        rebates.claim(_ep(e));
        assertEq(token.balanceOf(alice) - aliceT0, ta);
    }

    function test_NoSitAndEarn() public {
        vm.prank(alice);
        router.buy{value: 1 ether}(0, block.timestamp);
        uint256 e = rebates.currentEpoch();
        vm.warp(block.timestamp + 14 days);
        rebates.checkpoint();
        // bob never traded -> nothing; alice earns nothing for the epoch she did not trade in
        (uint256 tb,) = rebates.claimable(bob, e);
        (uint256 ta2,) = rebates.claimable(alice, e + 1);
        assertEq(tb, 0);
        assertEq(ta2, 0);
        // empty epoch e+1 carries forward
        assertEq(rebates.carryTokens(), rebates.baseEmission(e + 1));
    }
}
