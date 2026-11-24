// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Fixture} from "./Fixture.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockPancakePair} from "../src/mocks/MockPancake.sol";

/// Exposes the deck draw so the deck can be exercised without minting.
contract DeckHarness is TowackLaunch {
    constructor(VRFConfig memory cfg)
        TowackLaunch(address(1), address(2), address(3), block.timestamp, block.timestamp + 1, cfg, false)
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
        vm.expectRevert(
            abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, 0, wrapperPrice(LAUNCH_CALLBACK_GAS))
        );
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
        assertFalse(launch.instantClose());
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
        assertEq(r.paid, wrapperPrice(LAUNCH_CALLBACK_GAS), "exact wrapper price, not the buffered quote");
        assertEq(r.confirmations, 3);
        assertEq(r.callbackGasLimit, LAUNCH_CALLBACK_GAS);
        assertEq(r.sender, address(launch)); // the mock enforces ExtraArgsV1{nativePayment: true}
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

    function test_OnlyVRFWrapperCanFulfillCanFulfill() public {
        mintN(1);
        uint256[] memory w = new uint256[](1);
        vm.expectRevert(
            abi.encodeWithSelector(VRFConsumerV25.OnlyVRFWrapperCanFulfill.selector, address(this), address(vrf))
        );
        launch.rawFulfillRandomWords(1, w);
    }

    function test_FulfillAssignsAndEmits() public {
        mintN(1);
        // word 0 on a full deck -> slot 0 -> tier 0 (full refund)
        vm.expectEmit(true, true, false, true, address(launch));
        emit TowackLaunch.PrizeAssigned(user(0), 1, 0, 0.095 ether, 0);
        fulfillTo(address(launch), 1, 0);
        (bool minted, bool assigned, uint8 id, uint256 b, uint256 t, bool claimed) = launch.prizeOf(user(0));
        assertTrue(minted && assigned && !claimed);
        assertEq(id, 0);
        assertEq(b, 0.095 ether);
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
        assertEq(user(0).balance - b0, 0.095 ether);
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
        assertEq(address(launch).balance, 0.3 ether - 0.095 ether);
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
        assertEq(launch.bnbAssigned(), 166.25 ether);
        assertEq(launch.bonusAssigned(), 35_200_000e18);

        launch.closeMint();
        uint256 supplyBefore = token.totalSupply();
        launch.finalizeListing();

        assertEq(launch.bonusBurned(), 14_800_000e18);
        assertEq(supplyBefore - token.totalSupply(), 14_800_000e18);
        assertEq(launch.lpBnb(), 250 ether);
        assertEq(launch.lpTokens(), 200_000_000e18);
        // no referrals: leftover 500 - 166.25 = 333.75 -> 250 LP (cap) + 83.75 DrawV2
        assertEq(launch.sentToDrawV2(), 83.75 ether);
        assertEq(address(drawV2).balance, 83.75 ether);
        assertEq(address(launch).balance, 166.25 ether); // reserved prizes
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
        assertEq(paidBnb, 166.25 ether);
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

    /// N=1, no referrer, the sole minter wins (and claims) the top refund (0.095): the unreferred 0.005 is listed.
    function test_Undersold_TopRefundLeavesReferralShareForLp() public {
        mintN(1);
        fulfillTo(address(launch), requestOf(user(0)), 0);
        vm.prank(user(0));
        launch.claim();
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0.005 ether);
        assertEq(launch.lpTokens(), 4_000e18);
        assertEq(launch.sentToDrawV2(), 0);
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
        assertLe(launch.bnbAssigned(), 166.25 ether);
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
        assertLe(bnb, 166.25 ether);
        assertLe(bonus, 35_200_000e18);
        if (k == 5000) {
            assertEq(bnb, 166.25 ether);
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
        assertEq(launch.DECK_BNB_TOTAL(), 166.25 ether);
        // BNB tiers are 100/75/50/25% of the 0.095 residual left after the 5% referral set-aside
        assertEq(launch.REFERRAL_FEE(), 0.005 ether);
        uint256 residual = PRICE - launch.REFERRAL_FEE();
        assertEq(launch.prizeBnb(0), residual);
        assertEq(launch.prizeBnb(1), residual * 75 / 100);
        assertEq(launch.prizeBnb(2), residual * 50 / 100);
        assertEq(launch.prizeBnb(3), residual * 25 / 100);
        for (uint8 k; k < 11; ++k) {
            assertLe(launch.prizeBnb(k) + launch.REFERRAL_FEE(), PRICE, "prize + referral <= price");
        }
    }

    // ------------------------------------------------------------ referrals
    function test_Referral_ValidMintBindsAndAccrues() public {
        address ref = newAgent("ref");
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.expectEmit(true, true, false, true, address(launch));
        emit TowackLaunch.ReferralBound(u, ref);
        vm.expectEmit(true, true, false, true, address(launch));
        emit TowackLaunch.ReferralAccrued(ref, u, 0.005 ether);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}(ref);
        assertEq(launch.referrerOf(u), ref);
        assertEq(launch.referralUnclaimed(ref), 0.005 ether);
        assertEq(launch.referralEarned(ref), 0.005 ether);
        assertEq(launch.referralCount(ref), 1);
        assertEq(launch.referralUnclaimedTotal(), 0.005 ether);
        assertEq(launch.referralAccruedTotal(), 0.005 ether);
        address[] memory list = launch.referees(ref);
        assertEq(list.length, 1);
        assertEq(list[0], u);
        assertEq(token.balanceOf(u), 80_000e18);
        assertEq(address(launch).balance, PRICE);
    }

    function test_Referral_ClaimPaysAndZeroes() public {
        address ref = newAgent("ref");
        _mintRef(user(0), ref);
        uint256 b0 = ref.balance;
        vm.expectEmit(true, false, false, true, address(launch));
        emit TowackLaunch.ReferralClaimed(ref, 0.005 ether);
        vm.prank(ref);
        launch.claimReferral();
        assertEq(ref.balance - b0, 0.005 ether);
        assertEq(launch.referralUnclaimed(ref), 0);
        assertEq(launch.referralUnclaimedTotal(), 0);
        assertEq(launch.referralEarned(ref), 0.005 ether, "lifetime kept");
        vm.prank(ref);
        vm.expectRevert(TowackLaunch.NothingToClaimReferral.selector);
        launch.claimReferral();
    }

    function test_Referral_TwoMintersOneClaim() public {
        address ref = newAgent("ref");
        _mintRef(user(0), ref);
        _mintRef(user(1), ref);
        assertEq(launch.referralCount(ref), 2);
        assertEq(launch.referees(ref).length, 2);
        assertEq(launch.referees(ref)[1], user(1));
        uint256 b0 = ref.balance;
        vm.prank(ref);
        launch.claimReferral();
        assertEq(ref.balance - b0, 0.01 ether);
        assertEq(launch.referralEarned(ref), 0.01 ether);
    }

    function test_Referral_ZeroAddressAndZeroArg_NoBind_LeftoverKeepsShare() public {
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.recordLogs();
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}(address(0));
        _assertNoReferralLogs();
        mintN(1); // zero-arg mint()
        assertEq(launch.referrerOf(u), address(0));
        assertEq(launch.referrerOf(user(0)), address(0));
        assertEq(launch.referralUnclaimedTotal(), 0);
        assertEq(launch.referralCount(address(0)), 0);
        // both draw the top refund: 0.2 - 2 * 0.095 = 0.01 leftover (2 x the unreferred 0.005) goes to LP
        fulfillTo(address(launch), requestOf(u), 0);
        fulfillTo(address(launch), requestOf(user(0)), 0);
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0.01 ether);
        assertEq(address(launch).balance, 0.19 ether);
    }

    function test_Referral_SelfReferralReverts() public {
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.SelfReferral.selector);
        launch.mint{value: PRICE + launchFee}(u);
        assertEq(launch.mintCount(), 0);
    }

    function test_Referral_ReferrerWithoutAgentIdReverts() public {
        address u = newAgent("u");
        address noid = makeAddr("noid");
        vm.deal(u, PRICE + launchFee);
        vm.prank(u);
        vm.expectRevert(TowackLaunch.ReferrerHasNoAgentId.selector);
        launch.mint{value: PRICE + launchFee}(noid);
        assertEq(launch.mintCount(), 0);
    }

    function test_Referral_MinterWithoutAgentIdStillReverts() public {
        address ref = newAgent("ref");
        address noid = makeAddr("noid");
        vm.deal(noid, 1 ether);
        vm.prank(noid);
        vm.expectRevert(TowackLaunch.NoAgentId.selector);
        launch.mint{value: PRICE + launchFee}(ref);
    }

    function test_Referral_SecondMintStillOnePerWallet() public {
        address ref = newAgent("ref");
        address ref2 = newAgent("ref2");
        _mintRef(user(0), ref);
        vm.deal(user(0), PRICE + launchFee);
        vm.prank(user(0));
        vm.expectRevert(TowackLaunch.AlreadyMinted.selector);
        launch.mint{value: PRICE + launchFee}(ref2);
        assertEq(launch.referrerOf(user(0)), ref);
    }

    /// Worst case: one referred mint draws the top refund. Prize + referral == the whole 0.1.
    function test_Referral_Solvency_TopPrize_ClaimThenReferral() public {
        address ref = _soloReferredTopPrize();
        vm.prank(user(0));
        launch.claim();
        _assertSolvent();
        vm.prank(ref);
        launch.claimReferral();
        _assertSolvent();
        assertEq(address(launch).balance, 0);
    }

    function test_Referral_Solvency_TopPrize_ReferralThenClaim() public {
        address ref = _soloReferredTopPrize();
        vm.prank(ref);
        launch.claimReferral();
        _assertSolvent();
        vm.prank(user(0));
        launch.claim();
        _assertSolvent();
        assertEq(address(launch).balance, 0);
    }

    function test_Referral_ClaimBeforeFinalize_KeepsLpMath() public {
        address ref = newAgent("ref");
        for (uint256 i; i < 10; ++i) {
            _mintRef(user(i), ref);
        }
        fulfillUsers(0, 10, 42);
        vm.prank(ref);
        launch.claimReferral(); // 0.05 out before listing
        _assertSolvent();
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 1 ether - launch.bnbAssigned() - 0.05 ether);
        assertEq(
            launch.bnbAssigned() + launch.lpBnb() + launch.sentToDrawV2() + launch.referralAccruedTotal(), 10 * PRICE
        );
        assertEq(address(launch).balance, launch.bnbOutstanding());
    }

    function test_Referral_UnclaimedReservedAtFinalize() public {
        address ref = newAgent("ref");
        for (uint256 i; i < 10; ++i) {
            _mintRef(user(i), ref);
        }
        fulfillUsers(0, 10, 42);
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 1 ether - launch.bnbAssigned() - 0.05 ether);
        assertEq(address(launch).balance, launch.bnbOutstanding() + 0.05 ether);
        uint256 b0 = ref.balance;
        vm.prank(ref);
        launch.claimReferral();
        assertEq(ref.balance - b0, 0.05 ether);
    }

    function test_Referral_SweepLeavesReferralClaimable() public {
        address ref = newAgent("ref");
        _mintRef(user(0), ref);
        _mintRef(user(1), address(0));
        _mintRef(user(2), address(0));
        fulfillUsers(0, 3, 7);
        close();
        launch.finalizeListing();
        uint256 prizes = launch.bnbOutstanding();
        assertEq(address(launch).balance, prizes + 0.005 ether);
        vm.warp(launch.claimDeadline());
        uint256 v2Before = address(drawV2).balance;
        launch.sweepUnclaimed();
        assertEq(address(drawV2).balance - v2Before, prizes, "only prize BNB swept");
        assertEq(address(launch).balance, 0.005 ether);
        assertEq(launch.referralUnclaimedTotal(), 0.005 ether);
        // still claimable long after the prize window
        vm.warp(block.timestamp + 365 days);
        uint256 b0 = ref.balance;
        vm.prank(ref);
        launch.claimReferral();
        assertEq(ref.balance - b0, 0.005 ether);
        assertEq(address(launch).balance, 0);
    }

    function test_Referral_ClaimDuringMint() public {
        address ref = newAgent("ref");
        _mintRef(user(0), ref);
        vm.prank(ref);
        launch.claimReferral(); // VRF still pending, phase Minting
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Minting));
        assertEq(address(launch).balance, PRICE - 0.005 ether);
    }

    /// All 5000 mints referred: leftover 500 - 166.25 - 25 = 308.75 -> LP 250 + DrawV2 58.75.
    function test_Referral_SelloutAllReferred() public {
        address ref = newAgent("ref");
        for (uint256 i; i < 5000; ++i) {
            _mintRef(user(i), ref);
        }
        fulfillUsers(0, 5000, uint256(keccak256("sellout")));
        launch.closeMint();
        launch.finalizeListing();
        assertEq(launch.bnbAssigned(), 166.25 ether);
        assertEq(launch.referralUnclaimedTotal(), 25 ether);
        assertEq(launch.lpBnb(), 250 ether);
        assertEq(launch.sentToDrawV2(), 58.75 ether);
        assertEq(address(launch).balance, 166.25 ether + 25 ether);
        uint256 b0 = ref.balance;
        vm.prank(ref);
        launch.claimReferral();
        assertEq(ref.balance - b0, 25 ether);
        assertEq(launch.referralCount(ref), 5000);
    }

    /// Mixed referred / unreferred mints with referral + prize claims interleaved at every phase.
    function testFuzz_Referral_ConservationAndSolvency(uint256 n, uint256 salt, uint256 refMask, uint256 early) public {
        n = bound(n, 1, 120);
        early = bound(early, 0, n);
        address[3] memory refs = [newAgent("r0"), newAgent("r1"), newAgent("r2")];
        uint256 referred;
        for (uint256 i; i < n; ++i) {
            uint256 pick = uint256(keccak256(abi.encode(refMask, i))) % 4; // 0..2 = referrer, 3 = none
            if (pick < 3) {
                _mintRef(user(i), refs[pick]);
                ++referred;
            } else {
                _mintRef(user(i), address(0));
            }
            _assertSolvent();
        }
        assertEq(launch.referralAccruedTotal(), referred * 0.005 ether);
        fulfillUsers(0, n, salt);
        _assertSolvent();
        // a referrer pulls mid-way; some minters claim early
        if (refMask & 1 == 1 && launch.referralUnclaimed(refs[0]) > 0) {
            vm.prank(refs[0]);
            launch.claimReferral();
            _assertSolvent();
        }
        uint256 paidB;
        uint256 paidT;
        for (uint256 i; i < early; ++i) {
            (paidB, paidT) = _claimIfAny(user(i), paidB, paidT);
            _assertSolvent();
        }
        close();
        launch.finalizeListing();
        _assertSolvent();
        assertEq(
            launch.bnbAssigned() + launch.lpBnb() + launch.sentToDrawV2() + launch.referralAccruedTotal(), n * PRICE
        );
        assertEq(address(launch).balance, launch.bnbOutstanding() + launch.referralUnclaimedTotal());
        for (uint256 i = early; i < n; ++i) {
            (paidB, paidT) = _claimIfAny(user(i), paidB, paidT);
            _assertSolvent();
        }
        assertEq(paidB, launch.bnbAssigned());
        uint256 paidR;
        for (uint256 k; k < 3; ++k) {
            uint256 owed = launch.referralUnclaimed(refs[k]);
            if (owed == 0) continue;
            uint256 b0 = refs[k].balance;
            vm.prank(refs[k]);
            launch.claimReferral();
            assertEq(refs[k].balance - b0, owed);
            paidR += owed;
            _assertSolvent();
        }
        assertEq(launch.referralUnclaimedTotal(), 0);
        assertEq(address(launch).balance, 0);
        assertEq(
            launch.referralEarned(refs[0]) + launch.referralEarned(refs[1]) + launch.referralEarned(refs[2]),
            launch.referralAccruedTotal()
        );
        assertLe(paidR, launch.referralAccruedTotal());
    }

    function _mintRef(address u, address ref) internal {
        agentId.registerFor(u);
        vm.deal(u, PRICE + launchFee);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}(ref);
    }

    /// One referred mint (user(0) -> ref) that draws prize 0, closed and finalized.
    function _soloReferredTopPrize() internal returns (address ref) {
        ref = newAgent("ref");
        _mintRef(user(0), ref);
        fulfillTo(address(launch), requestOf(user(0)), 0);
        (,, uint8 id,,,) = launch.prizeOf(user(0));
        assertEq(id, 0);
        _assertSolvent();
        assertEq(address(launch).balance, launch.bnbOutstanding() + launch.referralUnclaimedTotal());
        close();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0);
        assertEq(launch.sentToDrawV2(), 0);
        assertTrue(token.tradingOpen());
        _assertSolvent();
    }

    function _assertSolvent() internal view {
        assertGe(address(launch).balance, launch.bnbOutstanding() + launch.referralUnclaimedTotal(), "solvency");
    }

    function _assertNoReferralLogs() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(launch)) continue;
            assertTrue(logs[i].topics[0] != TowackLaunch.ReferralBound.selector, "no bind");
            assertTrue(logs[i].topics[0] != TowackLaunch.ReferralAccrued.selector, "no accrue");
        }
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

/// Same fixture, but Launch deployed with `instantClose = true` (testnet rehearsal stack).
contract TowackLaunchInstantCloseTest is Fixture {
    function launchInstantClose() internal pure override returns (bool) {
        return true;
    }

    /// Deck slot 1900 (full deck) is prize 3: 0.02375 BNB refund, no bonus.
    uint256 constant WORD_PRIZE3 = 1900;

    function test_FlagSet() public view {
        assertTrue(launch.instantClose());
        assertEq(launch.mintEnd(), mintEnd);
    }

    function test_OneMint_CloseAndListBeforeMintEnd() public {
        mintN(1);
        fulfillTo(address(launch), requestOf(user(0)), WORD_PRIZE3);
        (,, uint8 id,,,) = launch.prizeOf(user(0));
        assertEq(id, 3);
        assertLt(block.timestamp, mintEnd);

        uint256 supply0 = token.totalSupply();
        launch.closeMint();
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Closed));
        assertEq(supply0 - token.totalSupply(), 4999 * 80_000e18, "unsold burned");

        launch.finalizeListing();
        assertLt(block.timestamp, mintEnd);
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Finalized));
        assertTrue(token.tradingOpen());
        // leftover = 0.1 - 0.02375 reserved refund = 0.07625 BNB, all to LP at 800,000 TWAK/BNB
        assertEq(launch.lpBnb(), 0.07625 ether);
        assertEq(launch.lpTokens(), 0.07625 ether * 800_000);
        assertEq(launch.sentToDrawV2(), 0);
        (uint112 r0, uint112 r1,) = MockPancakePair(token.pair()).getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);
        assertEq(wbnb.balanceOf(token.pair()), 0.07625 ether);
        assertEq(token.balanceOf(token.pair()), 61_000e18);
        // the refund is still claimable from escrow
        assertEq(address(launch).balance, 0.02375 ether);
        uint256 b0 = user(0).balance;
        vm.prank(user(0));
        launch.claim();
        assertEq(user(0).balance - b0, 0.02375 ether);
    }

    function test_CloseBeforeVrf_FinalizeWaitsForPrize() public {
        mintN(1);
        launch.closeMint(); // allowed: mintCount >= 1
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.PrizesPending.selector, 1));
        launch.finalizeListing();
        assertFalse(token.tradingOpen());
        // callback still lands after close, then listing works
        fulfillTo(address(launch), requestOf(user(0)), WORD_PRIZE3);
        launch.finalizeListing();
        assertTrue(token.tradingOpen());
    }

    function test_NoMintAfterInstantClose() public {
        mintN(1);
        launch.closeMint();
        address late = newAgent("late");
        vm.deal(late, PRICE + launchFee);
        vm.prank(late);
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Closed));
        launch.mint{value: PRICE + launchFee}();
    }

    /// Top refund (prize 0, 0.095), no referrer: the unreferred 0.005 is listed.
    function test_TopRefund_NoReferrer_ListsReferralShare() public {
        mintN(1);
        fulfillTo(address(launch), requestOf(user(0)), 0);
        launch.closeMint();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0.005 ether);
        assertTrue(token.tradingOpen());
        assertEq(wbnb.balanceOf(token.pair()), 0.005 ether);
    }

    /// Top refund (prize 0) on a referred mint: 0.095 prize + 0.005 referral reserved, no leftover, LP skipped,
    /// trading still opens.
    function test_TopRefund_Referred_NoLpButTradingOpens() public {
        address ref = newAgent("ref");
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}(ref);
        fulfillTo(address(launch), requestOf(u), 0);
        launch.closeMint();
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0);
        assertEq(launch.sentToDrawV2(), 0);
        assertTrue(token.tradingOpen());
        (uint112 r0, uint112 r1,) = MockPancakePair(token.pair()).getReserves();
        assertEq(uint256(r0) + r1, 0);
        assertEq(address(launch).balance, 0.1 ether);
    }

    /// Regression: force-sending 1 wei BNB (e.g. selfdestruct) when real leftover is 0 must NOT brick
    /// finalizeListing() via PancakePair MINIMUM_LIQUIDITY underflow; dust < MIN_LP_BNB goes to DrawV2 instead.
    function test_ForceSentDustBnbDoesNotBrickFinalizeListing() public {
        address ref = newAgent("ref");
        address u = newAgent("u");
        vm.deal(u, PRICE + launchFee);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee}(ref);
        fulfillTo(address(launch), requestOf(u), 0); // 0.095 refund + 0.005 referral = 0.1 (0 leftover)
        vm.deal(address(launch), address(launch).balance + 1); // simulate 1 wei forced BNB
        launch.closeMint();
        uint256 v2Before = address(drawV2).balance;
        launch.finalizeListing();
        assertEq(launch.lpBnb(), 0, "dust skipped for LP");
        assertEq(launch.sentToDrawV2(), 1, "dust routed to DrawV2");
        assertEq(address(drawV2).balance - v2Before, 1);
        assertTrue(token.tradingOpen());
    }

    /// Zero mints: no instant path. closeMint still needs mintEnd, then takes the existing burn-everything route.
    function test_ZeroMints_NoInstantClose() public {
        vm.expectRevert(TowackLaunch.MintStillOpen.selector);
        launch.closeMint();
        vm.warp(mintEnd);
        launch.closeMint();
        assertEq(uint256(launch.phase()), uint256(TowackLaunch.Phase.Finalized));
        assertEq(token.balanceOf(address(launch)), 0);
        assertFalse(token.tradingOpen());
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.WrongPhase.selector, TowackLaunch.Phase.Finalized));
        launch.finalizeListing();
    }
}
