// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";

contract TeamVestingTest is Fixture {
    function test_NothingBeforeCliff() public {
        assertEq(team.releasable(), 0);
        vm.warp(team.start() + 365 days - 1);
        assertEq(team.releasable(), 0);
        vm.expectRevert("nothing");
        team.release();
    }

    function test_LinearDailyAfterCliff() public {
        vm.warp(team.cliffEnd());
        assertEq(team.releasable(), 0); // no cliff unlock
        vm.warp(team.cliffEnd() + 1 days);
        assertEq(team.releasable(), uint256(50_000_000e18) / 1460);
        vm.warp(team.cliffEnd() + 730 days);
        assertEq(team.releasable(), 25_000_000e18);
        team.release();
        assertEq(token.balanceOf(teamWallet), 25_000_000e18);
    }

    function test_FullyVestedAfter5Years() public {
        vm.warp(team.start() + 365 days + 1460 days);
        team.release();
        assertEq(token.balanceOf(teamWallet), 50_000_000e18);
        assertEq(token.balanceOf(address(team)), 0);
    }

    function testFuzz_MonotonicAndBounded(uint256 t1, uint256 t2) public view {
        t1 = bound(t1, team.start(), team.start() + 3000 days);
        t2 = bound(t2, t1, team.start() + 3000 days);
        assertLe(team.vestedAmount(t1), team.vestedAmount(t2));
        assertLe(team.vestedAmount(t2), 50_000_000e18);
    }
}
