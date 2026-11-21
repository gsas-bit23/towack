// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackToken} from "../src/TowackToken.sol";
import {TokenBound} from "../src/TokenBound.sol";

contract TowackTokenTest is Fixture {
    function test_MetadataAndSupply() public view {
        assertEq(token.name(), "Towack");
        assertEq(token.symbol(), "TWAK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000e18);
    }

    function test_AllocationsSumTo100Percent() public view {
        uint256 sum = token.PUBLIC_MINT() + token.DRAW_V1_BONUS() + token.INITIAL_LP() + token.TRADER_REBATES()
            + token.TEAM_VESTING() + token.DRAW_V2_PRIZES() + token.SEASONS() + token.ECOSYSTEM() + token.POL_BUFFER();
        assertEq(sum, token.TOTAL_SUPPLY());
    }

    function test_RecipientBalances() public view {
        assertEq(token.balanceOf(address(launch)), 650_000_000e18);
        assertEq(token.balanceOf(address(rebates)), 100_000_000e18);
        assertEq(token.balanceOf(address(team)), 50_000_000e18);
        assertEq(token.balanceOf(address(drawV2)), 70_000_000e18);
        assertEq(token.balanceOf(seasons), 50_000_000e18);
        assertEq(token.balanceOf(ecosystem), 50_000_000e18);
        assertEq(token.balanceOf(polBuffer), 30_000_000e18);
    }

    function test_NoTransferTax() public {
        address b = makeAddr("b");
        vm.prank(seasons);
        token.transfer(b, 1000e18);
        assertEq(token.balanceOf(b), 1000e18);
    }

    function test_PairGuardBlocksPreListingDeposit() public {
        address pair = token.pair();
        vm.prank(seasons);
        vm.expectRevert(TowackToken.PairLocked.selector);
        token.transfer(pair, 1);
        // transferFrom path too
        vm.prank(seasons);
        token.approve(address(this), 1);
        vm.expectRevert(TowackToken.PairLocked.selector);
        token.transferFrom(seasons, pair, 1);
    }

    function test_OnlyLaunchOpensTrading() public {
        vm.expectRevert(TowackToken.OnlyLaunch.selector);
        token.openTrading();
    }

    function test_PairGuardLiftedAfterListing() public {
        launchWith(10, 1);
        assertTrue(token.tradingOpen());
        address pair = token.pair();
        vm.prank(seasons);
        token.transfer(pair, 1);
    }

    function test_BindOnlyOnceAndOnlyDeployer() public {
        vm.expectRevert(TokenBound.AlreadyBound.selector);
        team.bindToken(address(token));
        vm.prank(makeAddr("x"));
        vm.expectRevert(TokenBound.NotDeployer.selector);
        team.bindToken(address(token));
    }
}
