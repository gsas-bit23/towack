// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackRouter} from "../src/TowackRouter.sol";

contract TowackRouterTest is Fixture {
    address alice;

    function setUp() public override {
        super.setUp();
        launchWith(1000, 3); // lists 65 BNB / 52M TWAK
        alice = newAgent("alice");
        vm.deal(alice, 100 ether);
    }

    function _buy(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return router.buy{value: amt}(0, block.timestamp);
    }

    function test_BuyRequiresAgentId() public {
        address bob = makeAddr("bob");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TowackRouter.NoAgentId.selector);
        router.buy{value: 1 ether}(0, block.timestamp);
    }

    function test_BuyFeeSplit() public {
        uint256 out = _buy(alice, 1 ether);
        assertGt(out, 0);
        assertEq(token.balanceOf(alice), out);
        uint256 fee = 0.01 ether;
        assertEq(address(rebates).balance, fee / 2); // 50%
        assertEq(router.pendingLottery(), fee * 30 / 100);
        assertEq(router.pendingDev(), fee * 20 / 100);
        assertEq(router.feesPaidOf(alice), fee);
        assertEq(router.volumeOf(alice), 1 ether);
        assertEq(rebates.feesOf(rebates.currentEpoch(), alice), fee);

        uint256 v2Before = address(drawV2).balance;
        router.flushFees();
        assertEq(address(drawV2).balance - v2Before, fee * 30 / 100);
        assertEq(dev.balance, fee * 20 / 100);
        assertEq(address(router).balance, 0);
    }

    function test_BuySlippage() public {
        vm.prank(alice);
        vm.expectRevert();
        router.buy{value: 1 ether}(type(uint128).max, block.timestamp);
    }

    function test_SellExactApprovalAndFee() public {
        uint256 got = _buy(alice, 1 ether);
        vm.startPrank(alice);
        token.approve(address(router), got); // exact
        uint256 b0 = alice.balance;
        uint256 net = router.sell(got, 0, block.timestamp);
        vm.stopPrank();
        assertEq(alice.balance - b0, net);
        assertEq(token.allowance(alice, address(router)), 0);
        assertEq(token.allowance(address(router), address(pancake)), 0, "router left approval");
        assertEq(token.balanceOf(address(router)), 0);
        // gross = net / 0.99 (rounding)
        uint256 gross = router.volumeOf(alice) - 1 ether;
        assertEq(gross - gross / 100, net);
    }

    function test_SellWithoutApprovalReverts() public {
        uint256 got = _buy(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.sell(got, 0, block.timestamp);
    }

    function test_SellMinOutEnforced() public {
        uint256 got = _buy(alice, 1 ether);
        vm.startPrank(alice);
        token.approve(address(router), got);
        vm.expectRevert();
        router.sell(got, 10 ether, block.timestamp);
        vm.stopPrank();
    }

    function test_NoMaxApprovalEverGranted() public {
        for (uint256 i; i < 3; ++i) {
            uint256 got = _buy(alice, 0.5 ether);
            vm.startPrank(alice);
            token.approve(address(router), got);
            router.sell(got, 0, block.timestamp);
            vm.stopPrank();
            assertEq(token.allowance(address(router), address(pancake)), 0);
        }
    }

    function test_RejectsDirectBnb() public {
        (bool ok,) = address(router).call{value: 1}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------ leash
    function test_DailyLimitEnforced() public {
        vm.prank(alice);
        router.setDailyLimit(1 ether);
        _buy(alice, 0.6 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TowackRouter.DailyLimitExceeded.selector, 1.2 ether, 1 ether));
        router.buy{value: 0.6 ether}(0, block.timestamp);
        // resets next day
        vm.warp(block.timestamp + 1 days);
        _buy(alice, 0.6 ether);
        assertEq(router.spentToday(alice), 0.6 ether);
    }

    function test_SellsCountTowardLimit() public {
        uint256 got = _buy(alice, 1 ether);
        vm.startPrank(alice);
        router.setDailyLimit(1.1 ether); // already spent 1
        token.approve(address(router), got);
        vm.expectRevert();
        router.sell(got, 0, block.timestamp); // ~0.98 BNB gross > 0.1 left
        vm.stopPrank();
    }

    function test_LimitRaiseIsDelayed_DecreaseImmediate() public {
        vm.startPrank(alice);
        router.setDailyLimit(1 ether);
        assertEq(router.effectiveLimit(alice), 1 ether);
        router.setDailyLimit(5 ether);
        assertEq(router.effectiveLimit(alice), 1 ether); // not yet
        vm.expectRevert();
        router.buy{value: 2 ether}(0, block.timestamp);
        vm.warp(block.timestamp + 1 days);
        assertEq(router.effectiveLimit(alice), 5 ether);
        router.buy{value: 2 ether}(0, block.timestamp);
        router.setDailyLimit(0.5 ether); // immediate decrease
        assertEq(router.effectiveLimit(alice), 0.5 ether);
        vm.expectRevert(TowackRouter.BadLimit.selector);
        router.setDailyLimit(0);
        vm.stopPrank();
    }

    function test_DefaultUnlimited() public view {
        assertEq(router.effectiveLimit(alice), type(uint256).max);
    }

    function testFuzz_FeeSplitConserves(uint96 amt) public {
        uint256 a = bound(uint256(amt), 1e9, 10 ether);
        uint256 rb0 = address(rebates).balance;
        _buy(alice, a);
        uint256 fee = a / 100;
        assertEq((address(rebates).balance - rb0) + router.pendingLottery() + router.pendingDev(), fee);
    }
}
