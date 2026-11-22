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

    function test_OnlyRouterDepositsBoost() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(RebateDistributor.OnlyRouter.selector);
        rebates.depositBoost{value: 1}();
    }

    function test_DepositBoostAddsPotWithoutFees() public {
        uint256 e = rebates.currentEpoch();
        vm.deal(address(router), 1 ether);
        vm.prank(address(router));
        rebates.depositBoost{value: 0.3 ether}();
        assertEq(rebates.bnbDeposited(e), 0.3 ether);
        assertEq(rebates.totalFees(e), 0);
        // epoch with only boosts and no Agent fees rolls its BNB forward
        uint256 t0 = block.timestamp;
        vm.warp(t0 + 7 days);
        rebates.checkpoint();
        assertEq(rebates.bnbBudget(e), 0);
        assertEq(rebates.carryBnb(), 0.3 ether);
        // next Agent trader collects it
        vm.prank(alice);
        router.buy{value: 1 ether}(0, t0 + 7 days);
        vm.warp(t0 + 14 days);
        rebates.checkpoint();
        (, uint256 b) = rebates.claimable(alice, e + 1);
        assertEq(b, 0.3 ether + 0.005 ether);
    }

    function test_SetRouter() public {
        address newRouter = makeAddr("newRouter");
        // non-deployer
        vm.prank(alice);
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        rebates.setRouter(newRouter);
        // zero
        vm.expectRevert(bytes("router"));
        rebates.setRouter(address(0));
        // deployer (this fixture) after bind
        rebates.setRouter(newRouter);
        assertEq(rebates.router(), newRouter);
        // old router locked out of both entry points
        vm.deal(address(router), 1 ether);
        vm.startPrank(address(router));
        vm.expectRevert(RebateDistributor.OnlyRouter.selector);
        rebates.recordFee{value: 1}(alice, 1);
        vm.expectRevert(RebateDistributor.OnlyRouter.selector);
        rebates.depositBoost{value: 1}();
        vm.stopPrank();
        // ...so trades through the old router now revert (no stranded fee)
        vm.prank(alice);
        vm.expectRevert(RebateDistributor.OnlyRouter.selector);
        router.buy{value: 1 ether}(0, block.timestamp);
        // new router can do both
        uint256 e = rebates.currentEpoch();
        vm.deal(newRouter, 1 ether);
        vm.startPrank(newRouter);
        rebates.recordFee{value: 0.1 ether}(alice, 0.2 ether);
        rebates.depositBoost{value: 0.1 ether}();
        vm.stopPrank();
        assertEq(rebates.feesOf(e, alice), 0.2 ether);
        assertEq(rebates.bnbDeposited(e), 0.2 ether);
    }

    function test_SetRouterBeforeBind() public {
        vm.prank(alice);
        RebateDistributor fresh = new RebateDistributor();
        address r = makeAddr("r");
        vm.prank(bob);
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        fresh.setRouter(r);
        vm.prank(alice);
        fresh.setRouter(r);
        assertEq(fresh.router(), r);
        assertEq(address(fresh.token()), address(0));
        vm.deal(r, 1 ether);
        vm.startPrank(r);
        fresh.recordFee{value: 0.01 ether}(bob, 0.02 ether);
        fresh.depositBoost{value: 0.01 ether}();
        vm.stopPrank();
        assertEq(fresh.bnbDeposited(0), 0.02 ether);
        // bind still needs the exact 100M allocation
        vm.prank(alice);
        vm.expectRevert();
        fresh.bind(address(token), r);
    }

    function test_RouterAdminHandoffAndFreeze() public {
        address tl = makeAddr("timelock");
        address r2 = makeAddr("r2");
        assertEq(rebates.routerAdmin(), address(this), "deployer starts as admin");
        vm.prank(alice);
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        rebates.setRouterAdmin(alice);
        rebates.setRouterAdmin(tl);
        assertEq(rebates.routerAdmin(), tl);
        // the deployer lost the power once handed off
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        rebates.setRouter(r2);
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        rebates.setRouterAdmin(address(this));
        vm.prank(tl);
        rebates.setRouter(r2);
        assertEq(rebates.router(), r2);
        // freeze
        vm.prank(tl);
        rebates.setRouterAdmin(address(0));
        vm.prank(tl);
        vm.expectRevert(RebateDistributor.NotRouterAdmin.selector);
        rebates.setRouter(makeAddr("r3"));
        assertEq(rebates.router(), r2);
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
