// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackRouter} from "../src/TowackRouter.sol";

contract TowackRouterTest is Fixture {
    address alice;

    function setUp() public override {
        super.setUp();
        launchWith(1000, 3); // lists ~65 BNB at the mint price
        alice = newAgent("alice");
        vm.deal(alice, 100 ether);
    }

    function _buy(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return router.buy{value: amt}(0, block.timestamp);
    }

    // ------------------------------------------------------------ open access (non-Agent wallets)
    function test_NonAgentCanBuyAndSell_NoRebateCredit() public {
        address bob = makeAddr("bob"); // no Agent ID
        assertEq(agentId.balanceOf(bob), 0);
        vm.deal(bob, 10 ether);
        uint256 e = rebates.currentEpoch();
        uint256 rb0 = address(rebates).balance;
        uint256 pot0 = rebates.bnbDeposited(e);
        uint256 tf0 = rebates.totalFees(e);

        uint256 got = _buy(bob, 1 ether);
        assertGt(got, 0);
        assertEq(token.balanceOf(bob), got);
        uint256 fee = 0.01 ether;
        // 50% still forwarded, as an unattributed epoch BNB boost
        assertEq(address(rebates).balance - rb0, fee / 2);
        assertEq(rebates.bnbDeposited(e) - pot0, fee / 2);
        assertEq(rebates.feesOf(e, bob), 0);
        assertEq(rebates.totalFees(e), tf0);
        // 30/20 still accrue; router stats still count every trader
        assertEq(router.pendingLottery(), fee * 30 / 100);
        assertEq(router.pendingDev(), fee * 20 / 100);
        assertEq(router.feesPaidOf(bob), fee);
        assertEq(router.volumeOf(bob), 1 ether);

        vm.startPrank(bob);
        token.approve(address(router), got);
        uint256 b0 = bob.balance;
        uint256 net = router.sell(got, 0, block.timestamp);
        vm.stopPrank();
        assertGt(net, 0);
        assertEq(bob.balance - b0, net);
        assertEq(rebates.feesOf(e, bob), 0);
        assertEq(rebates.totalFees(e), tf0);

        uint256 v2Before = address(drawV2).balance;
        uint256 lot = router.pendingLottery();
        uint256 dv = router.pendingDev();
        router.flushFees();
        assertEq(address(drawV2).balance - v2Before, lot);
        assertEq(dev.balance, dv);

        // nothing claimable for the non-Agent after the epoch closes
        vm.warp(block.timestamp + 7 days);
        rebates.checkpoint();
        (uint256 t, uint256 b) = rebates.claimable(bob, e);
        assertEq(t, 0);
        assertEq(b, 0);
    }

    function test_NonAgentBoostGoesToAgentTraders() public {
        address bob = makeAddr("bob");
        vm.deal(bob, 10 ether);
        uint256 e = rebates.currentEpoch();
        _buy(alice, 1 ether); // agent: 0.01 fee, 0.005 boost, fee credit
        _buy(bob, 2 ether); // non-agent: 0.02 fee, 0.01 boost, no credit
        assertEq(rebates.totalFees(e), 0.01 ether);
        vm.warp(block.timestamp + 7 days);
        rebates.checkpoint();
        assertEq(rebates.bnbBudget(e), 0.015 ether);
        (uint256 ta, uint256 ba) = rebates.claimable(alice, e);
        assertEq(ta, rebates.tokenBudget(e)); // alice is the only Agent trader: full TWAK budget
        assertEq(ba, 0.015 ether); // ... plus bob's boost
        uint256[] memory ep = new uint256[](1);
        ep[0] = e;
        uint256 b0 = alice.balance;
        vm.prank(alice);
        rebates.claim(ep);
        assertEq(alice.balance - b0, 0.015 ether);
        // bob's claim pays nothing
        uint256 bobT = token.balanceOf(bob);
        uint256 bobB = bob.balance;
        vm.prank(bob);
        rebates.claim(ep);
        assertEq(token.balanceOf(bob), bobT);
        assertEq(bob.balance, bobB);
    }

    function test_NonAgentUnderpayAndSlippageStillRevert() public {
        address bob = makeAddr("bob");
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(TowackRouter.ZeroAmount.selector);
        router.buy{value: 0}(0, block.timestamp);
        vm.prank(bob);
        vm.expectRevert();
        router.buy{value: 1 ether}(type(uint128).max, block.timestamp);
        uint256 got = _buy(bob, 1 ether);
        vm.startPrank(bob);
        vm.expectRevert(); // no approval
        router.sell(got, 0, block.timestamp);
        token.approve(address(router), got);
        vm.expectRevert(); // min out
        router.sell(got, 10 ether, block.timestamp);
        vm.expectRevert(TowackRouter.ZeroAmount.selector);
        router.sell(0, 0, block.timestamp);
        vm.stopPrank();
    }

    function test_NonAgentLeashWorks() public {
        address bob = makeAddr("bob");
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        router.setDailyLimit(1 ether);
        _buy(bob, 0.6 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(TowackRouter.DailyLimitExceeded.selector, 1.2 ether, 1 ether));
        router.buy{value: 0.6 ether}(0, block.timestamp);
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

    function testFuzz_FeeSplitConserves(uint96 amt, bool agent) public {
        uint256 a = bound(uint256(amt), 1e9, 10 ether);
        address who = alice;
        if (!agent) {
            who = makeAddr("nonAgent");
            vm.deal(who, 100 ether);
        }
        uint256 e = rebates.currentEpoch();
        uint256 rb0 = address(rebates).balance;
        uint256 pot0 = rebates.bnbDeposited(e);
        _buy(who, a);
        uint256 fee = a / 100;
        assertEq((address(rebates).balance - rb0) + router.pendingLottery() + router.pendingDev(), fee);
        assertEq(rebates.bnbDeposited(e) - pot0, address(rebates).balance - rb0);
        assertEq(rebates.feesOf(e, who), agent ? fee : 0);
        assertEq(rebates.totalFees(e), agent ? fee : 0);
    }
}
