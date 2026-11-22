// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fixture} from "./Fixture.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockPancakePair} from "../src/mocks/MockPancake.sol";

/// Exposes the deck draw so the deck can be exercised without minting.
contract DeckHarness is TowackLaunch {
    constructor(VRFConfig memory cfg)
        TowackLaunch(address(1), address(2), address(3), block.timestamp, block.timestamp + 1, cfg)
    {}

    function draw(uint256 word) external returns (uint8) {
        return _drawFromDeck(word);
    }
}

contract TowackLaunchTest is Fixture {
    uint256[11] internal FULL = [uint256(500), 600, 800, 1600, 20, 40, 80, 160, 320, 400, 480];

    // ------------------------------------------------------------ mint gate
    function test_MintRequiresAgentId() public {
        address u = makeAddr("noid");
        vm.deal(u, 1 ether);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.NoAgentId.selector);
        launch.mint{value: PRICE + launchFee}();
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
        vm.deal(user(0), PRICE + launchFee);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.AlreadyMinted.selector);
        launch.mint{value: PRICE + launchFee}();
    }

    function test_WrongPriceReverts() public {
        address u = newAgent("u");
        vm.deal(u, 1 ether);
        vm.startPrank(u);
        vm.expectRevert(TowackLaunch.WrongPrice.selector);
        launch.mint{value: 0.09 ether}();
        // exactly 0.1 BNB is no longer enough: the VRF fee is on top
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, 0, launchFee));
        launch.mint{value: PRICE}();
        vm.stopPrank();
        assertEq(u.balance, 1 ether);
        assertEq(launch.mintCount(), 0);
    }

    function test_MintWindow() public {
        address u = newAgent("u");
        vm.deal(u, 1 ether);
        vm.warp(mintEnd);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.MintNotOpen.selector);
        launch.mint{value: PRICE + launchFee}();
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
        vm.deal(late, PRICE + launchFee);
        vm.prank(late);
        vm.expectRevert(TowackLaunch.SoldOut.selector);
        launch.mint{value: PRICE + launchFee}();
        // sellout allows close before mintEnd
        launch.closeMint();
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Closed));
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

    // ------------------------------------------------------------ per-mint VRF
    function test_EachMintRequestsVrfWithConfig() public {
        mintN(2);
        agentId.registerFor(user(2));
        vm.deal(user(2), PRICE + launchFee);
        vm.recordLogs();
        vm.prank(user(2));
        launch.mint{value: PRICE + launchFee}();
        VrfReq memory r = lastVrfRequest(vm.getRecordedLogs());
        for (uint256 i; i < 3; ++i) {
            uint256 rid = requestOf(user(i));
            assertEq(rid, i + 1); // one request per mint
            assertEq(launch.requestMinter(rid), user(i));
        }
        assertEq(r.requestId, 3);
        assertEq(r.keyHash, KEY_HASH);
        assertEq(r.subId, subId);
        assertEq(r.confirmations, 3);
        assertEq(r.callbackGasLimit, LAUNCH_CALLBACK_GAS);
        assertEq(r.numWords, 1);
        assertEq(r.sender, address(launch));
        assertEq(r.extraArgs, abi.encodeWithSelector(bytes4(0x92fd1338), true)); // nativePayment: true
        assertEq(launch.pendingCount(), 3);
    }

    function test_MintEmitsPrizeRequested() public {
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.expectEmit(true, true, false, true, address(launch));
        emit TowackLaunch.PrizeRequested(u, 1, 1);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}();
    }

    function test_OnlyCoordinatorCanFulfill() public {
        mintN(1);
        uint256[] memory w = new uint256[](1);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.OnlyCoordinator.selector, address(this), address(vrf)));
        launch.rawFulfillRandomWords(1, w);
    }

    function test_FulfillAssignsAndEmits() public {
        mintN(1);
        // word 0 on a full deck -> slot 0 -> tier 0 (full refund)
        vm.expectEmit(true, true, false, true, address(launch));
        emit TowackLaunch.PrizeAssigned(user(0), 1, 0, 0.1 ether, 0);
        fulfillTo(address(launch), 1, 0);
        (bool minted, bool assigned, uint8 id, uint256 b, uint256 t, bool claimed) = launch.prizeOf(user(0));
        assertTrue(minted && assigned && !claimed);
        assertEq(id, 0);
        assertEq(b, 0.1 ether);
        assertEq(t, 0);
        assertEq(launch.remaining(0), 499);
        assertEq(launch.remainingTotal(), 4999);
        assertEq(launch.pendingCount(), 0);
    }

    function test_UnknownAndDuplicateFulfilmentIgnored() public {
        mintN(1);
        uint256[] memory w = new uint256[](1);
        w[0] = 7;
        vm.prank(address(vrf));
        launch.rawFulfillRandomWords(999, w); // unknown id: no effect, no revert
        assertEq(launch.assignedCount(), 0);

        fulfillTo(address(launch), 1, 0); // tier 0
        vm.prank(address(vrf));
        launch.rawFulfillRandomWords(1, w); // duplicate: ignored
        (,, uint8 id,,,) = launch.prizeOf(user(0));
        assertEq(id, 0);
        assertEq(launch.assignedCount(), 1);
        assertEq(launch.remainingTotal(), 4999);

        uint256[] memory empty = new uint256[](0);
        address u2 = newAgent("u2");
        vm.deal(u2, PRICE + launchFee);
        vm.prank(u2);
        launch.mint{value: PRICE + launchFee}();
        uint256 rid2 = requestOf(u2);
        vm.prank(address(vrf));
        launch.rawFulfillRandomWords(rid2, empty); // no words: ignored
        assertEq(launch.assignedCount(), 1);
    }

    function test_RetryAfterDelay_StaleIgnored() public {
        mintN(1);
        uint256 first = requestOf(user(0));
        vm.expectRevert(TowackLaunch.TooEarly.selector);
        launch.retryPrize{value: launchFee}(user(0));
        vm.warp(block.timestamp + launch.VRF_RETRY_DELAY());
        launch.retryPrize{value: launchFee}(user(0)); // permissionless
        uint256 second = requestOf(user(0));
        assertTrue(second != first);
        assertEq(launch.requestMinter(first), address(0));

        fulfillTo(address(launch), first, 0); // stale: ignored
        (, bool assigned,,,,) = launch.prizeOf(user(0));
        assertFalse(assigned);
        assertEq(launch.remainingTotal(), 5000);

        fulfillTo(address(launch), second, 4999); // last slot -> tier 10 (no win)
        (, bool a2, uint8 id,,,) = launch.prizeOf(user(0));
        assertTrue(a2);
        assertEq(id, 10);

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(TowackLaunch.AlreadyAssigned.selector);
        launch.retryPrize{value: launchFee}(user(0));
        vm.expectRevert(TowackLaunch.NotMinter.selector);
        launch.retryPrize{value: launchFee}(makeAddr("rando"));
    }

    function test_RetryWorksAfterClose() public {
        mintN(2);
        fulfillTo(address(launch), requestOf(user(0)), 1);
        close();
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.PrizesPending.selector, 1));
        launch.finalizeListing();
        vm.warp(block.timestamp + 1 hours);
        launch.retryPrize{value: launchFee}(user(1));
        fulfillTo(address(launch), requestOf(user(1)), 2);
        launch.finalizeListing();
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Finalized));
    }

    /// The walk maps slot index -> tier in id order over the remaining counts.
    function test_DeckWalkBoundaries() public {
        DeckHarness h = _harness();
        // cumulative boundaries on a full deck: 500,1100,1900,3500,3520,3560,3640,3800,4120,4520,5000
        uint256[11] memory starts = [uint256(0), 500, 1100, 1900, 3500, 3520, 3560, 3640, 3800, 4120, 4520];
        for (uint8 k; k < 11; ++k) {
            DeckHarness f = _harness();
            assertEq(f.draw(starts[k]), k, "start");
            DeckHarness g = _harness();
            assertEq(g.draw(starts[k] + FULL[k] - 1), k, "end");
        }
        // modulo: word 5000 == slot 0 on a full deck
        assertEq(h.draw(5000), 0);
        assertEq(h.remainingTotal(), 4999);
        // now deck has 499 in tier 0, so slot 499 is tier 1
        assertEq(h.draw(499), 1);
    }

    function test_CallbackGasWellUnderLimit() public {
        mintN(2);
        fulfillTo(address(launch), requestOf(user(0)), 3); // warm-up so the measured call is a typical non-first draw
        uint256 rid = requestOf(user(1));
        uint256[] memory w = new uint256[](1);
        w[0] = 4_998; // 4999 slots remain: last slot = worst-case walk (tier 10)
        vm.cool(address(launch));
        vm.prank(address(vrf));
        uint256 g0 = gasleft();
        launch.rawFulfillRandomWords(rid, w);
        uint256 used = g0 - gasleft();
        emit log_named_uint("callback gas (cold storage, worst-case walk)", used);
        assertLt(used, 150_000);
        (,, uint8 id,,,) = launch.prizeOf(user(1));
        assertEq(id, 10);
    }

    // ------------------------------------------------------------ claims
    function test_CannotClaimBeforeFulfilment() public {
        mintN(1);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.NotAssigned.selector);
        launch.claim();
    }

    function test_ClaimImmediatelyAfterAssignment_DoubleClaimReverts() public {
        mintN(3);
        fulfillTo(address(launch), requestOf(user(0)), 0); // full refund
        fulfillTo(address(launch), requestOf(user(1)), 3499); // slot 3499 of 4999 remaining: tier 4 (5x) after the pop above
        fulfillTo(address(launch), requestOf(user(2)), 4997); // last slot of the 4998 remaining: no win

        (,, uint8 id1,,,) = launch.prizeOf(user(1));
        assertEq(id1, 4);

        uint256 b0 = user(0).balance;
        vm.prank(user(0));
        launch.claim();
        assertEq(user(0).balance - b0, 0.1 ether);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.AlreadyClaimed.selector);
        launch.claim();

        uint256 t1 = token.balanceOf(user(1));
        vm.prank(user(1));
        launch.claim();
        assertEq(token.balanceOf(user(1)) - t1, 320_000e18);
        assertEq(token.balanceOf(user(1)), 400_000e18); // 5x of 80k

        vm.prank(user(2));
        vm.expectRevert(TowackLaunch.NothingToClaim.selector);
        launch.claim();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(TowackLaunch.NotMinter.selector);
        launch.claim();

        assertEq(launch.bnbOutstanding(), 0);
        assertEq(launch.bonusOutstanding(), 0);
        assertEq(address(launch).balance, 0.2 ether);
    }

    function test_CannotFinalizeWhilePending() public {
        mintN(3);
        fulfillUsers(0, 2, 1);
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Minting));
        launch.finalizeListing();
        close();
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.PrizesPending.selector, 1));
        launch.finalizeListing();
        // fulfilment after close still lands
        fulfillUsers(2, 1, 1);
        launch.finalizeListing();
    }

    function test_FinalizeOnlyOnce() public {
        launchWith(5, 7);
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Finalized));
        launch.finalizeListing();
    }

    function test_SweepUnclaimedAfterWindow() public {
        launchWith(100, 5);
        vm.expectRevert(TowackLaunch.TooEarly.selector);
        launch.sweepUnclaimed();
        uint256 owed = launch.bnbOutstanding();
        assertEq(address(launch).balance, owed);
        assertEq(token.balanceOf(address(launch)), launch.bonusOutstanding());
        uint256 v2Before = address(drawV2).balance;
        vm.warp(launch.claimDeadline());
        launch.sweepUnclaimed();
        assertEq(address(drawV2).balance - v2Before, owed);
        assertEq(token.balanceOf(address(launch)), 0);
        // a minter with an unclaimed prize can no longer claim
        for (uint256 i; i < 100; ++i) {
            (,,, uint256 b, uint256 t,) = launch.prizeOf(user(i));
            if (b + t > 0) {
                vm.prank(user(i));
                vm.expectRevert(TowackLaunch.ClaimWindowClosed.selector);
                launch.claim();
                break;
            }
        }
    }

    // ------------------------------------------------------------ sellout economics + deck counts
    function test_Sellout_FullFlow() public {
        mintN(5000);
        fulfillUsers(0, 5000, uint256(keccak256("sellout")));

        // Exact deck counts: every slot drawn once.
        uint256[11] memory counts;
        for (uint256 i; i < 5000; ++i) {
            (, bool assigned, uint8 id,,,) = launch.prizeOf(user(i));
            assertTrue(assigned);
            counts[id]++;
        }
        for (uint256 k; k < 11; ++k) {
            assertEq(counts[k], FULL[k], "tier count");
            assertEq(launch.remaining(uint8(k)), 0);
        }
        assertEq(launch.remainingTotal(), 0);
        assertEq(launch.bnbAssigned(), 175 ether);
        assertEq(launch.bonusAssigned(), 35_200_000e18);

        launch.closeMint();
        uint256 supplyBefore = token.totalSupply();
        launch.finalizeListing();

        assertEq(launch.bonusBurned(), 14_800_000e18);
        assertEq(supplyBefore - token.totalSupply(), 14_800_000e18);
        assertEq(launch.lpBnb(), 250 ether);
        assertEq(launch.lpTokens(), 200_000_000e18);
        assertEq(launch.sentToDrawV2(), 75 ether);
        assertEq(address(drawV2).balance, 75 ether);
        assertEq(address(launch).balance, 175 ether); // reserved prizes
        assertEq(token.balanceOf(address(launch)), 35_200_000e18);

        MockPancakePair pair = MockPancakePair(token.pair());
        assertEq(token.balanceOf(address(pair)), 200_000_000e18);
        assertEq(wbnb.balanceOf(address(pair)), 250 ether);
        assertEq(pair.lpAtZero(), pair.totalSupply());

        uint256 paidBnb;
        uint256 paidBonus;
        for (uint256 i; i < 5000; ++i) {
            (,,, uint256 b, uint256 t,) = launch.prizeOf(user(i));
            if (b + t == 0) continue;
            uint256 b0 = user(i).balance;
            uint256 t0 = token.balanceOf(user(i));
            vm.prank(user(i));
            launch.claim();
            assertEq(user(i).balance - b0, b);
            assertEq(token.balanceOf(user(i)) - t0, t);
            paidBnb += b;
            paidBonus += t;
        }
        assertEq(paidBnb, 175 ether);
        assertEq(paidBonus, 35_200_000e18);
        assertEq(address(launch).balance, 0);
        assertEq(token.balanceOf(address(launch)), 0);
        assertEq(launch.bnbOutstanding(), 0);
        assertEq(launch.bonusOutstanding(), 0);
    }

    function test_Undersold_LeftoverDeckGoesToLp() public {
        mintN(1000);
        fulfillUsers(0, 1000, 99);
        uint256 assignedBnb = launch.bnbAssigned();
        uint256 assignedBonus = launch.bonusAssigned();
        // Some early claims before listing: only outstanding prizes stay reserved.
        uint256 claimedBnb;
        for (uint256 i; i < 50; ++i) {
            (,,, uint256 b, uint256 t,) = launch.prizeOf(user(i));
            if (b + t == 0) continue;
            vm.prank(user(i));
            launch.claim();
            claimedBnb += b;
        }
        assertEq(launch.remainingTotal(), 4000);
        close();
        uint256 supply0 = token.totalSupply();
        launch.finalizeListing();

        // Unsold deck slots were never reserved: proceeds - assigned prizes all went to LP (< 250 cap).
        assertEq(launch.lpBnb(), 100 ether - assignedBnb);
        assertEq(launch.sentToDrawV2(), 0);
        assertEq(launch.lpTokens(), launch.lpBnb() * 800_000);
        assertEq(address(launch).balance, assignedBnb - claimedBnb);
        assertEq(address(launch).balance, launch.bnbOutstanding());
        // Unassigned bonus reserve burned.
        assertEq(launch.bonusBurned(), 50_000_000e18 - assignedBonus);
        assertEq(supply0 - token.totalSupply(), launch.bonusBurned() + (200_000_000e18 - launch.lpTokens()), "burns");
        assertEq(token.balanceOf(address(launch)), launch.bonusOutstanding());
        MockPancakePair pair = MockPancakePair(token.pair());
        assertEq(token.balanceOf(address(pair)), wbnb.balanceOf(address(pair)) * 800_000);
        assertTrue(token.tradingOpen());
    }

    /// N=1 and the sole minter wins (and claims) a full refund: nothing left to list.
    function test_Undersold_NothingToList() public {
        mintN(1);
        fulfillTo(address(launch), requestOf(user(0)), 0);
        vm.prank(user(0));
        launch.claim();
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0);
        assertEq(token.balanceOf(address(launch)), 0);
        assertEq(address(launch).balance, 0);
        assertTrue(token.tradingOpen());
    }

    // ------------------------------------------------------------ fuzz
    /// Full mint -> VRF -> close -> finalize -> claim flow; BNB and TWAK conservation.
    function testFuzz_SolvencyFlow(uint256 n, uint256 salt, uint256 earlyClaimers) public {
        n = bound(n, 1, 200);
        earlyClaimers = bound(earlyClaimers, 0, n);
        mintN(n);
        fulfillUsers(0, n, salt);
        uint256 proceeds = n * PRICE;
        assertLe(launch.bnbAssigned(), 175 ether);
        assertLe(launch.bnbAssigned(), proceeds);
        assertLe(launch.bonusAssigned(), 35_200_000e18);
        assertEq(launch.remainingTotal() + n, 5000);

        uint256 paidB;
        uint256 paidT;
        for (uint256 i; i < earlyClaimers; ++i) {
            (paidB, paidT) = _claimIfAny(user(i), paidB, paidT);
        }
        close();
        launch.finalizeListing();
        assertEq(launch.bnbAssigned() + launch.lpBnb() + launch.sentToDrawV2(), proceeds);
        assertLe(launch.lpBnb(), 250 ether);
        assertEq(launch.lpTokens(), launch.lpBnb() * 800_000);
        assertEq(address(launch).balance, launch.bnbOutstanding());
        for (uint256 i = earlyClaimers; i < n; ++i) {
            (paidB, paidT) = _claimIfAny(user(i), paidB, paidT);
        }
        assertEq(paidB, launch.bnbAssigned());
        assertEq(paidT, launch.bonusAssigned());
        assertEq(address(launch).balance, 0);
        assertEq(token.balanceOf(address(launch)), 0);
    }

    /// Pure deck fuzz: K draws from a full deck with arbitrary words.
    function testFuzz_DeckInvariants(uint256 k, uint256 salt) public {
        k = bound(k, 1, 5000);
        DeckHarness h = _harness();
        uint256[11] memory drawn;
        uint256 bnb;
        uint256 bonus;
        for (uint256 i; i < k; ++i) {
            uint8 id = h.draw(uint256(keccak256(abi.encode(salt, i))));
            assertLt(id, 11);
            drawn[id]++;
            bnb += h.prizeBnb(id);
            bonus += h.prizeBonus(id);
        }
        uint256[11] memory rem = h.remainingCounts();
        uint256 sum;
        for (uint256 j; j < 11; ++j) {
            assertEq(drawn[j] + rem[j], FULL[j], "assigned + remaining == initial");
            sum += rem[j];
        }
        assertEq(sum, h.remainingTotal());
        assertEq(h.remainingTotal() + k, 5000);
        assertLe(bnb, 175 ether);
        assertLe(bonus, 35_200_000e18);
        if (k == 5000) {
            assertEq(bnb, 175 ether);
            assertEq(bonus, 35_200_000e18);
        }
    }

    function test_PrizeTableTotals() public view {
        uint256 slots;
        uint256 bnb;
        uint256 bonus;
        for (uint8 k; k < 11; ++k) {
            assertEq(launch.prizeSlots(k), FULL[k]);
            assertTrue(launch.prizeBnb(k) == 0 || launch.prizeBonus(k) == 0, "exclusive");
            slots += launch.prizeSlots(k);
            bnb += launch.prizeSlots(k) * launch.prizeBnb(k);
            bonus += launch.prizeSlots(k) * launch.prizeBonus(k);
        }
        assertEq(slots, 5000);
        assertEq(bnb, launch.DECK_BNB_TOTAL());
        assertEq(bonus, launch.DECK_BONUS_TOTAL());
        assertEq(launch.prizeBnb(10) + launch.prizeBonus(10), 0);
    }

    // ------------------------------------------------------------ helpers
    function _harness() internal returns (DeckHarness) {
        return new DeckHarness(vrfCfg(LAUNCH_CALLBACK_GAS));
    }

    function _claimIfAny(address u, uint256 paidB, uint256 paidT) internal returns (uint256, uint256) {
        (,,, uint256 b, uint256 t,) = launch.prizeOf(u);
        if (b + t == 0) return (paidB, paidT);
        vm.prank(u);
        launch.claim();
        return (paidB + b, paidT + t);
    }
}
