// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockPancakePair} from "../src/mocks/MockPancake.sol";

contract TowackLaunchTest is Fixture {
    // ------------------------------------------------------------ mint gate
    function test_MintRequiresAgentId() public {
        address u = makeAddr("noid");
        vm.deal(u, 1 ether);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.NoAgentId.selector);
        launch.mint{value: PRICE}();
    }

    function test_MintGivesTokensInstantly() public {
        mintN(1);
        assertEq(token.balanceOf(user(0)), 80_000e18);
        assertEq(address(launch).balance, PRICE);
        assertEq(launch.minterIndex(user(0)), 1);
        assertTrue(launch.hasMinted(user(0)));
    }

    function test_OneMintPerAgentId() public {
        mintN(1);
        vm.deal(user(0), PRICE);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.AlreadyMinted.selector);
        launch.mint{value: PRICE}();
    }

    function test_WrongPriceReverts() public {
        address u = newAgent("u");
        vm.deal(u, 1 ether);
        vm.startPrank(u);
        vm.expectRevert(TowackLaunch.WrongPrice.selector);
        launch.mint{value: 0.09 ether}();
        vm.expectRevert(TowackLaunch.WrongPrice.selector);
        launch.mint{value: 0.2 ether}();
        vm.stopPrank();
    }

    function test_MintWindow() public {
        address u = newAgent("u");
        vm.deal(u, 1 ether);
        vm.warp(mintEnd);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.MintNotOpen.selector);
        launch.mint{value: PRICE}();
    }

    function test_DirectBnbRejected() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(launch).call{value: 1}("");
        assertFalse(ok);
    }

    function test_CapAt5000_AndSelloutCloses() public {
        mintN(5000);
        assertEq(launch.mintCount(), 5000);
        address late = newAgent("late");
        vm.deal(late, PRICE);
        vm.prank(late);
        vm.expectRevert(TowackLaunch.SoldOut.selector);
        launch.mint{value: PRICE}();
        // sellout allows close before mintEnd
        launch.closeMint();
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.DrawPending));
    }

    // ------------------------------------------------------------ close / burn
    function test_CloseBeforeEndReverts() public {
        mintN(3);
        vm.expectRevert(TowackLaunch.MintStillOpen.selector);
        launch.closeMint();
    }

    function test_UndersoldBurnsUnsoldMintTokens() public {
        mintN(100);
        uint256 supplyBefore = token.totalSupply();
        vm.warp(mintEnd);
        launch.closeMint();
        uint256 burned = (5000 - 100) * 80_000e18;
        assertEq(token.totalSupply(), supplyBefore - burned);
        assertEq(token.balanceOf(address(launch)), 250_000_000e18); // bonus + LP remain
    }

    function test_ZeroMintsBurnsEverything() public {
        vm.warp(mintEnd);
        launch.closeMint();
        assertEq(token.balanceOf(address(launch)), 0);
        assertEq(token.totalSupply(), 350_000_000e18);
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Finalized));
    }

    // ------------------------------------------------------------ VRF
    function test_SingleVrfRequestWithConfig() public {
        mintN(2);
        vm.warp(mintEnd);
        launch.closeMint();
        assertEq(vrf.nextRequestId(), 2); // exactly one request
        (bytes32 kh, uint256 sub, uint16 conf, uint32 gasLim, uint32 words,) = vrf.lastRequest();
        assertEq(kh, bytes32(uint256(1)));
        assertEq(sub, 1);
        assertEq(conf, 3);
        assertEq(gasLim, 200_000);
        assertEq(words, 1);
    }

    function test_OnlyCoordinatorCanFulfill() public {
        mintN(2);
        vm.warp(mintEnd);
        launch.closeMint();
        uint256[] memory w = new uint256[](1);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.OnlyCoordinator.selector, address(this), address(vrf)));
        launch.rawFulfillRandomWords(1, w);
    }

    function test_RetryAfterDelay_StaleIgnored() public {
        mintN(2);
        vm.warp(mintEnd);
        launch.closeMint();
        uint256 first = launch.vrfRequestId();
        vm.expectRevert(TowackLaunch.TooEarly.selector);
        launch.retryDraw();
        vm.warp(block.timestamp + 1 days);
        launch.retryDraw();
        uint256 second = launch.vrfRequestId();
        assertTrue(second != first);
        vrf.fulfill(first, 123); // stale, ignored
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.DrawPending));
        vrf.fulfill(second, 456);
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Seeded));
        assertEq(launch.seed(), bytes32(uint256(456)));
    }

    function test_FinalizeOnlyOnce() public {
        launchWith(5, 7);
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Finalized));
        launch.finalizeDraw();
    }

    // ------------------------------------------------------------ sellout economics + slot counts
    function test_Sellout_FullFlow() public {
        mintN(5000);
        launch.closeMint();
        vrf.fulfill(launch.vrfRequestId(), uint256(keccak256("sellout")));
        uint256 supplyBefore = token.totalSupply();
        launch.finalizeDraw();

        assertEq(launch.bnbPrizeTotal(), 175 ether);
        assertEq(launch.bonusTotal(), 35_200_000e18);
        assertEq(launch.lpBnb(), 250 ether);
        assertEq(launch.lpTokens(), 200_000_000e18);
        assertEq(launch.sentToDrawV2(), 75 ether);
        assertEq(address(drawV2).balance, 75 ether);
        assertEq(address(launch).balance, 175 ether);
        // unused bonus burned (50M - 35.2M)
        assertEq(supplyBefore - token.totalSupply(), 14_800_000e18);
        assertEq(token.balanceOf(address(launch)), 35_200_000e18);

        // Pair seeded at mint price, LP burned
        MockPancakePair pair = MockPancakePair(token.pair());
        assertEq(token.balanceOf(address(pair)), 200_000_000e18);
        assertEq(wbnb.balanceOf(address(pair)), 250 ether);
        assertEq(pair.lpAtZero(), pair.totalSupply());

        // Enumerate every minter: exact slot counts, all claim, contract ends empty.
        uint256[5] memory bnbCounts;
        uint256[7] memory bonusCounts;
        uint256 paidBnb;
        uint256 paidBonus;
        for (uint256 i; i < 5000; ++i) {
            (uint256 bt, uint256 ba, uint256 tt, uint256 ta) = launch.prizeOf(user(i));
            bnbCounts[bt]++;
            bonusCounts[tt]++;
            if (ba + ta > 0) {
                vm.prank(user(i));
                launch.claim();
                paidBnb += ba;
                paidBonus += ta;
            }
        }
        assertEq(bnbCounts[0], 500);
        assertEq(bnbCounts[1], 600);
        assertEq(bnbCounts[2], 800);
        assertEq(bnbCounts[3], 1600);
        assertEq(bnbCounts[4], 1500);
        assertEq(bonusCounts[0], 20);
        assertEq(bonusCounts[1], 40);
        assertEq(bonusCounts[2], 80);
        assertEq(bonusCounts[3], 160);
        assertEq(bonusCounts[4], 320);
        assertEq(bonusCounts[5], 400);
        assertEq(bonusCounts[6], 3980);
        assertEq(paidBnb, 175 ether);
        assertEq(paidBonus, 35_200_000e18);
        assertEq(address(launch).balance, 0);
        assertEq(token.balanceOf(address(launch)), 0);
        assertEq(launch.bnbOutstanding(), 0);
        assertEq(launch.bonusOutstanding(), 0);
    }

    function test_Undersold_ListsAtMintPrice() public {
        launchWith(1000, 99);
        // prizes: 100*0.1 + 120*0.075 + 160*0.05 + 320*0.025 = 10 + 9 + 8 + 8 = 35
        assertEq(launch.bnbPrizeTotal(), 35 ether);
        assertEq(launch.lpBnb(), 65 ether);
        assertEq(launch.lpTokens(), 65 ether * 800_000);
        assertEq(launch.sentToDrawV2(), 0);
        MockPancakePair pair = MockPancakePair(token.pair());
        assertEq(token.balanceOf(address(pair)) / wbnb.balanceOf(address(pair)), 800_000);
    }

    // ------------------------------------------------------------ claims
    function test_ClaimFlowAndDoubleClaim() public {
        launchWith(50, 42);
        uint256 winners;
        for (uint256 i; i < 50; ++i) {
            address u = user(i);
            (, uint256 ba,, uint256 ta) = launch.prizeOf(u);
            uint256 b0 = u.balance;
            uint256 t0 = token.balanceOf(u);
            vm.startPrank(u);
            if (ba + ta == 0) {
                vm.expectRevert(TowackLaunch.NothingToClaim.selector);
                launch.claim();
            } else {
                winners++;
                launch.claim();
                assertEq(u.balance - b0, ba);
                assertEq(token.balanceOf(u) - t0, ta);
                vm.expectRevert(TowackLaunch.AlreadyClaimed.selector);
                launch.claim();
            }
            vm.stopPrank();
        }
        assertGt(winners, 0);
    }

    function test_NonMinterCannotClaim() public {
        launchWith(5, 1);
        vm.prank(makeAddr("rando"));
        vm.expectRevert(TowackLaunch.NotMinter.selector);
        launch.claim();
    }

    function test_ClaimBeforeFinalizeReverts() public {
        mintN(5);
        closeAndSeed(1);
        vm.prank(user(0));
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Seeded));
        launch.claim();
    }

    function test_SweepUnclaimedAfterWindow() public {
        launchWith(100, 5);
        vm.expectRevert(TowackLaunch.TooEarly.selector);
        launch.sweepUnclaimed();
        uint256 owed = launch.bnbOutstanding();
        uint256 v2Before = address(drawV2).balance;
        vm.warp(launch.claimDeadline());
        launch.sweepUnclaimed();
        assertEq(address(drawV2).balance - v2Before, owed);
        assertEq(token.balanceOf(address(launch)), 0);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.ClaimWindowClosed.selector);
        launch.claim();
    }

    // ------------------------------------------------------------ fuzz: solvency + exact counts
    function testFuzz_SolvencyAndSlotCounts(uint256 n, uint256 word) public {
        n = bound(n, 1, 300);
        launchWith(n, word);

        uint256 proceeds = n * PRICE;
        assertLe(launch.bnbPrizeTotal(), proceeds);
        assertLe(launch.bonusTotal(), 50_000_000e18);
        assertEq(launch.bnbPrizeTotal() + launch.lpBnb() + launch.sentToDrawV2(), proceeds);
        assertLe(launch.lpBnb(), 250 ether);
        assertEq(launch.lpTokens(), launch.lpBnb() * 800_000);

        uint256[5] memory bc;
        uint256[7] memory tc;
        uint256 paidB;
        uint256 paidT;
        for (uint256 i; i < n; ++i) {
            (uint256 bt, uint256 ba, uint256 tt, uint256 ta) = launch.prizeOf(user(i));
            bc[bt]++;
            tc[tt]++;
            if (ba + ta > 0) {
                vm.prank(user(i));
                launch.claim();
                paidB += ba;
                paidT += ta;
            }
        }
        for (uint256 k; k < 4; ++k) {
            assertEq(bc[k], launch.bnbTierCount(n, k), "bnb tier count");
        }
        for (uint256 k; k < 6; ++k) {
            assertEq(tc[k], launch.bonusTierCount(n, k), "bonus tier count");
        }
        assertEq(paidB, launch.bnbPrizeTotal());
        assertEq(paidT, launch.bonusTotal());
        assertEq(address(launch).balance, 0);
        assertEq(token.balanceOf(address(launch)), 0);
    }

    /// Pure accounting fuzz over the full range of N (no minting needed).
    function testFuzz_TierTotalsBounded(uint256 n) public view {
        n = bound(n, 1, 5000);
        uint256 slotsB;
        uint256 prizes;
        for (uint256 k; k < 4; ++k) {
            slotsB += launch.bnbTierCount(n, k);
            prizes += launch.bnbTierCount(n, k) * launch.bnbTierAmount(k);
        }
        uint256 slotsT;
        uint256 bonus;
        for (uint256 k; k < 6; ++k) {
            slotsT += launch.bonusTierCount(n, k);
            bonus += launch.bonusTierCount(n, k) * launch.bonusTierAmount(k);
        }
        assertLe(slotsB, n);
        assertLe(slotsT, n);
        assertLe(prizes, n * 0.035 ether);
        assertLe(bonus, 35_200_000e18);
    }
}
