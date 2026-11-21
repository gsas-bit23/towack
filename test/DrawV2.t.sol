// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract DrawV2Test is Fixture {
    address alice;
    address bob;

    function setUp() public override {
        super.setUp();
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vm.startPrank(seasons);
        token.transfer(alice, 1_000_000e18);
        token.transfer(bob, 1_000_000e18);
        vm.stopPrank();
        vm.deal(address(drawV2), 10 ether);
    }

    function _setPriceViaTimelock(uint256 p) internal {
        bytes memory data = abi.encodeCall(DrawV2.setUsdPerTwak, (p));
        timelock.schedule(address(drawV2), 0, data, bytes32(0), bytes32(p), 2 days);
        vm.expectRevert();
        timelock.execute(address(drawV2), 0, data, bytes32(0), bytes32(p));
        vm.warp(block.timestamp + 2 days);
        timelock.execute(address(drawV2), 0, data, bytes32(0), bytes32(p));
    }

    function test_DirectSetterReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        drawV2.setUsdPerTwak(1);
        _setPriceViaTimelock(0.0002e18);
        assertEq(drawV2.usdPerTwak(), 0.0002e18);
    }

    function test_TicketsOneDollarEach() public {
        _setPriceViaTimelock(0.0002e18); // $0.0002 per TWAK => 5000 TWAK per ticket
        assertEq(drawV2.ticketsFor(5000e18), 1);
        assertEq(drawV2.ticketsFor(4999e18), 0);
        assertEq(drawV2.ticketsFor(50_000e18), 10);
    }

    function test_EnterDrawSettleClaim() public {
        _setPriceViaTimelock(0.0002e18);
        uint256 r = drawV2.currentRound();
        uint256 supply0 = token.totalSupply();
        vm.startPrank(alice);
        token.approve(address(drawV2), 50_000e18);
        drawV2.enter(50_000e18); // 10 tickets
        vm.stopPrank();
        vm.startPrank(bob);
        token.approve(address(drawV2), 5_000e18);
        drawV2.enter(5_000e18); // 1 ticket
        vm.stopPrank();
        assertEq(token.totalSupply(), supply0 - 55_000e18, "tickets burn TWAK");
        assertEq(drawV2.ticketsOf(r, alice), 10);

        vm.expectRevert(DrawV2.RoundNotOver.selector);
        drawV2.requestDraw(r);
        vm.warp(block.timestamp + 7 days);
        drawV2.requestDraw(r);
        (, uint256 reqId,,,,,,,,) = drawV2.rounds(r);
        vrf.fulfill(reqId, 3); // ticket #3 -> alice (tickets 0..9)
        drawV2.settle(r);
        (,,,,,, address winner, uint256 tp, uint256 bp,) = drawV2.rounds(r);
        assertEq(winner, alice);
        assertEq(tp, 700_000e18);
        assertEq(bp, 2 ether);

        vm.prank(bob);
        vm.expectRevert(DrawV2.NotWinner.selector);
        drawV2.claimPrize(r);
        uint256 b0 = alice.balance;
        vm.prank(alice);
        drawV2.claimPrize(r);
        assertEq(alice.balance - b0, 2 ether);
        assertEq(token.balanceOf(alice), 1_000_000e18 - 50_000e18 + 700_000e18);
    }

    function test_WinnerSelectionLastTicket() public {
        _setPriceViaTimelock(0.0002e18);
        uint256 r = drawV2.currentRound();
        vm.startPrank(alice);
        token.approve(address(drawV2), 50_000e18);
        drawV2.enter(50_000e18);
        vm.stopPrank();
        vm.startPrank(bob);
        token.approve(address(drawV2), 5_000e18);
        drawV2.enter(5_000e18);
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        drawV2.requestDraw(r);
        (, uint256 reqId,,,,,,,,) = drawV2.rounds(r);
        vrf.fulfill(reqId, 10); // ticket #10 -> bob
        drawV2.settle(r);
        (,,,,,, address winner,,,) = drawV2.rounds(r);
        assertEq(winner, bob);
    }

    function test_NoPriceNoEntry() public {
        vm.prank(alice);
        vm.expectRevert(DrawV2.NoPrice.selector);
        drawV2.enter(1e18);
    }
}
