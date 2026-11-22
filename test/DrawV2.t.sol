// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fixture} from "./Fixture.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {TokenBound} from "../src/TokenBound.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {VRFWrapperMock} from "./VRFWrapperMock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Words that land each prize id (slot = word % 10,000; first slot of each band).
abstract contract WheelWords {
    uint256[7] internal WORD = [uint256(0), 2_100, 5_300, 7_500, 8_900, 9_700, 9_900];
    uint256[7] internal MULT = [uint256(0), 5_000, 10_000, 15_000, 20_000, 50_000, 100_000];
}

contract DrawV2Test is Fixture, WheelWords {
    address alice;
    address bob;
    uint256 constant POOL = 70_000_000e18;

    function setUp() public override {
        super.setUp();
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        // players pay the VRF fee in native on every enter / retry
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(seasons, 100 ether);
        vm.startPrank(seasons);
        token.transfer(alice, 5_000_000e18);
        token.transfer(bob, 5_000_000e18);
        vm.stopPrank();
        vm.prank(alice);
        token.approve(address(drawV2), type(uint256).max);
        vm.prank(bob);
        token.approve(address(drawV2), type(uint256).max);
    }

    /// Stand-alone pool on the shared wrapper mock (no subscription / consumer registration needed).
    function _newPool(address preset) internal returns (DrawV2 d) {
        d = new DrawV2(address(timelock), preset, vrfCfg(DRAW_CALLBACK_GAS));
    }

    function _rawFulfil(DrawV2 d, uint256 req, uint256 word) internal {
        uint256[] memory w = new uint256[](1);
        w[0] = word;
        vm.prank(address(vrf));
        d.rawFulfillRandomWords(req, w);
    }

    function _enter(address who, uint256 amt) internal returns (uint256 spinId, uint256 req) {
        vm.prank(who);
        (spinId, req) = drawV2.enter{value: drawFee}(amt);
    }

    function _spin(uint256 spinId)
        internal
        view
        returns (address, uint8, uint8, uint64, uint256, uint256, uint256, uint256)
    {
        return drawV2.spins(spinId);
    }

    function _solvent(DrawV2 d) internal view {
        assertGe(token.balanceOf(address(d)), d.reservedTwak() + d.outstandingTwak(), "TWAK solvency");
        assertGe(address(d).balance, d.reservedBnb() + d.outstandingBnb(), "BNB solvency");
    }

    // ---------------------------------------------------------------- table
    function test_PayoutTableSumsAndEV() public view {
        (uint256[7] memory m, uint256[7] memory s) = drawV2.payoutTable();
        uint256 slots;
        uint256 ev;
        for (uint256 i; i < 7; ++i) {
            assertEq(m[i], MULT[i]);
            slots += s[i];
            ev += s[i] * m[i];
        }
        assertEq(slots, 10_000, "10,000 slots");
        assertEq(ev / 10_000, drawV2.EXPECTED_RETURN_BPS(), "EV = 95%");
        assertEq(ev, 9_500 * 10_000, "exact, no rounding");
        assertEq(s[0], 2_100);
        assertEq(s[1], 3_200);
        assertEq(s[2], 2_200);
        assertEq(s[3], 1_400);
        assertEq(s[4], 800);
        assertEq(s[5], 200);
        assertEq(s[6], 100);
    }

    function test_PrizeForWordBoundaries() public view {
        uint256[7] memory last = [uint256(2_099), 5_299, 7_499, 8_899, 9_699, 9_899, 9_999];
        for (uint256 i; i < 7; ++i) {
            assertEq(drawV2.prizeForWord(WORD[i]), i, "band start");
            assertEq(drawV2.prizeForWord(last[i]), i, "band end");
            assertEq(drawV2.prizeForWord(WORD[i] + 10_000 * 7), i, "mod 10,000");
        }
        assertEq(drawV2.prizeForWord(type(uint256).max), drawV2.prizeForWord(type(uint256).max % 10_000));
    }

    function testFuzz_PrizeForWordMatchesCumTable(uint256 word) public view {
        uint256 slot = word % 10_000;
        uint256 cum;
        uint256 want = 6;
        for (uint256 i; i < 7; ++i) {
            cum += drawV2.prizeSlots(i);
            if (slot < cum) {
                want = i;
                break;
            }
        }
        assertEq(drawV2.prizeForWord(word), want);
    }

    // ---------------------------------------------------------------- limits
    function test_MinEntry() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DrawV2.EntryTooSmall.selector, 100e18 - 1, 100e18));
        drawV2.enter{value: drawFee}(100e18 - 1);
        (uint256 id,) = _enter(alice, 100e18);
        assertEq(id, 1);
    }

    function test_MaxEntryIsHalfPercentOfAvailable() public {
        assertEq(drawV2.availableTwak(), POOL);
        assertEq(drawV2.maxEntry(), 350_000e18, "0.5% of 70M");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DrawV2.EntryTooLarge.selector, 350_000e18 + 1, 350_000e18));
        drawV2.enter{value: drawFee}(350_000e18 + 1);
        _enter(alice, 350_000e18);
        // a 10x win would be 3.5M = exactly 5% of the 70M that was available.
        assertEq(drawV2.reservedTwak(), 3_500_000e18);
        assertEq(drawV2.reservedTwak() * 10_000 / POOL, 500);
    }

    function test_RevertWhenPoolCannotCoverTenX() public {
        DrawV2 d = _newPool(address(token));
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(999e18); // 10 x 100 = 1,000 > 999
        vm.expectRevert(abi.encodeWithSelector(DrawV2.PoolTooSmall.selector, 1_000e18, 999e18));
        d.enter{value: drawFee}(100e18);
        // covers 10x but the 5% cap still blocks it (needs 20,000 available for a 100 entry)
        d.seed(18_000e18);
        vm.expectRevert(abi.encodeWithSelector(DrawV2.EntryTooLarge.selector, 100e18, 94_995e15));
        d.enter{value: drawFee}(100e18);
        d.seed(1_001e18); // 20,000 available
        assertEq(d.maxEntry(), 100e18);
        d.enter{value: drawFee}(100e18);
        vm.stopPrank();
        assertEq(d.reservedTwak(), 1_000e18);
    }

    function test_EmptyPoolReverts() public {
        DrawV2 d = _newPool(address(token));
        vm.startPrank(alice);
        token.approve(address(d), 100e18);
        vm.expectRevert(abi.encodeWithSelector(DrawV2.PoolTooSmall.selector, 1_000e18, 0));
        d.enter{value: drawFee}(100e18);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- pool accounting
    function test_EntryCreditsPoolNoBurn() public {
        uint256 supply = token.totalSupply();
        _enter(alice, 10_000e18);
        assertEq(token.totalSupply(), supply, "nothing burned");
        assertEq(token.balanceOf(address(drawV2)), POOL + 10_000e18);
        assertEq(drawV2.totalEntered(), 10_000e18);
        // available = balance - reserved - outstanding = 70M + 10k - 100k
        assertEq(drawV2.availableTwak(), POOL + 10_000e18 - 100_000e18);
        // the 0x keeps the whole entry in the pool and frees the reservation
        fulfillTo(address(drawV2), 1, WORD[0]);
        assertEq(drawV2.availableTwak(), POOL + 10_000e18);
        assertEq(drawV2.reservedTwak(), 0);
    }

    function test_PendingReservationConcurrentEnters() public {
        uint256 a = 300_000e18;
        _enter(alice, a);
        uint256 avail1 = POOL - 9 * a; // +a in, -10a reserved
        assertEq(drawV2.availableTwak(), avail1);
        assertEq(drawV2.maxEntry(), avail1 / 200);
        _enter(bob, 330_000e18);
        assertEq(drawV2.reservedTwak(), 10 * a + 3_300_000e18);
        uint256 avail2 = avail1 - 9 * 330_000e18;
        assertEq(drawV2.availableTwak(), avail2);
        // a third player cannot exceed the shrunken cap
        uint256 cap = drawV2.maxEntry();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DrawV2.EntryTooLarge.selector, cap + 1, cap));
        drawV2.enter{value: drawFee}(cap + 1);
        _enter(alice, cap);

        // all three hit 10x, fulfilled out of order: everyone is paid in full
        fulfillTo(address(drawV2), 3, WORD[6]);
        fulfillTo(address(drawV2), 1, WORD[6]);
        fulfillTo(address(drawV2), 2, WORD[6]);
        assertEq(drawV2.reservedTwak(), 0);
        assertEq(drawV2.outstandingTwak(), 10 * (a + 330_000e18 + cap));
        _solvent(drawV2);
        uint256 a0 = token.balanceOf(alice);
        vm.prank(alice);
        drawV2.claim();
        assertEq(token.balanceOf(alice) - a0, 10 * (a + cap));
        vm.prank(bob);
        drawV2.claim();
        assertEq(drawV2.outstandingTwak(), 0);
        _solvent(drawV2);
    }

    function test_ConcurrentMaxEntriesNeverOverdraw() public {
        DrawV2 d = _newPool(address(token));
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        uint256 n;
        while (d.maxEntry() >= 100e18) {
            d.enter{value: drawFee}(d.maxEntry());
            ++n;
        }
        vm.stopPrank();
        assertGt(n, 10);
        for (uint256 i = 1; i <= n; ++i) {
            (,,,,,,, uint256 req) = d.spins(i);
            fulfillTo(address(d), req, WORD[6]);
        }
        _solvent(d);
        vm.prank(seasons);
        d.claim();
        _solvent(d);
        assertEq(d.outstandingTwak(), 0);
    }

    // ---------------------------------------------------------------- payouts
    function test_EveryTierPaysItsMultiplier() public {
        uint256 amt = 1_000e18;
        for (uint256 i; i < 7; ++i) {
            (uint256 id, uint256 req) = _enter(alice, amt);
            uint256 owed0 = drawV2.owedTwak(alice);
            fulfillTo(address(drawV2), req, WORD[i]);
            (, uint8 status, uint8 pid,,,,,) = _spin(id);
            (uint256 tP,) = drawV2.spinPrize(id);
            assertEq(status, 2);
            assertEq(pid, i);
            assertEq(tP, amt * MULT[i] / 10_000);
            assertEq(drawV2.owedTwak(alice) - owed0, tP);
        }
        // 0 + 0.5 + 1 + 1.5 + 2 + 5 + 10 = 20 entries' worth
        assertEq(drawV2.owedTwak(alice), 20 * amt);
        assertEq(drawV2.reservedTwak(), 0);
        assertEq(drawV2.owedBnb(alice), 0, "empty BNB pot");
    }

    function test_ZeroXPaysNothing() public {
        (uint256 id, uint256 req) = _enter(alice, 5_000e18);
        fulfillTo(address(drawV2), req, WORD[0]);
        (,, uint8 pid,,,,,) = _spin(id);
        (uint256 tP, uint256 bP) = drawV2.spinPrize(id);
        assertEq(pid, 0);
        assertEq(tP, 0);
        assertEq(bP, 0);
        vm.prank(alice);
        vm.expectRevert(DrawV2.NothingToClaim.selector);
        drawV2.claim();
    }

    function test_TenXPaysTenXPlusTwoPercentBnb() public {
        vm.deal(address(drawV2), 10 ether);
        (uint256 id, uint256 req) = _enter(alice, 100_000e18);
        assertEq(drawV2.reservedBnb(), 0.2 ether);
        assertEq(drawV2.availableBnb(), 9.8 ether);
        fulfillTo(address(drawV2), req, WORD[6]);
        (uint256 tP, uint256 bP) = drawV2.spinPrize(id);
        assertEq(tP, 1_000_000e18);
        assertEq(bP, 0.2 ether);
        uint256 t0 = token.balanceOf(alice);
        uint256 b0 = alice.balance;
        vm.prank(alice);
        drawV2.claim();
        assertEq(token.balanceOf(alice) - t0, 1_000_000e18);
        assertEq(alice.balance - b0, 0.2 ether);
        assertEq(address(drawV2).balance, 9.8 ether);
        vm.prank(alice);
        vm.expectRevert(DrawV2.NothingToClaim.selector);
        drawV2.claim();
    }

    function test_FiveXPaysOnePercentBnb() public {
        vm.deal(address(drawV2), 10 ether);
        (uint256 id, uint256 req) = _enter(alice, 100_000e18);
        fulfillTo(address(drawV2), req, WORD[5]);
        (uint256 tP, uint256 bP) = drawV2.spinPrize(id);
        assertEq(tP, 500_000e18);
        assertEq(bP, 0.1 ether);
        assertEq(drawV2.reservedBnb(), 0);
        assertEq(drawV2.availableBnb(), 9.9 ether);
    }

    function test_NoBnbBelowFiveX() public {
        vm.deal(address(drawV2), 10 ether);
        for (uint256 i; i < 5; ++i) {
            (uint256 id, uint256 req) = _enter(alice, 1_000e18);
            fulfillTo(address(drawV2), req, WORD[i]);
            (, uint256 bP) = drawV2.spinPrize(id);
            assertEq(bP, 0);
        }
        assertEq(drawV2.owedBnb(alice), 0);
        assertEq(drawV2.reservedBnb(), 0);
        assertEq(drawV2.availableBnb(), 10 ether);
    }

    function test_BnbBonusCappedUnderConcurrency() public {
        vm.deal(address(drawV2), 10 ether);
        uint256 sum;
        for (uint256 i; i < 20; ++i) {
            uint256 before = drawV2.availableBnb();
            _enter(i % 2 == 0 ? alice : bob, 1_000e18);
            uint256 res = before - drawV2.availableBnb();
            assertEq(res, before * 200 / 10_000, "2% of available");
            sum += res;
        }
        for (uint256 i = 1; i <= 20; ++i) fulfillTo(address(drawV2), i, WORD[6]);
        assertEq(drawV2.outstandingBnb(), sum);
        assertLe(sum, 10 ether);
        _solvent(drawV2);
        vm.prank(alice);
        drawV2.claim();
        vm.prank(bob);
        drawV2.claim();
        assertEq(address(drawV2).balance, 10 ether - sum);
    }

    function test_EmptyBnbPotStillPaysTwak() public {
        assertEq(address(drawV2).balance, 0);
        (uint256 id, uint256 req) = _enter(alice, 10_000e18);
        assertEq(drawV2.reservedBnb(), 0);
        fulfillTo(address(drawV2), req, WORD[6]);
        (uint256 tP, uint256 bP) = drawV2.spinPrize(id);
        assertEq(tP, 100_000e18);
        assertEq(bP, 0);
        uint256 t0 = token.balanceOf(alice);
        vm.prank(alice);
        drawV2.claim();
        assertEq(token.balanceOf(alice) - t0, 100_000e18);
    }

    function test_BnbArrivingWhilePendingIsNotPromised() public {
        (uint256 id, uint256 req) = _enter(alice, 10_000e18);
        vm.deal(address(this), 5 ether);
        (bool ok,) = address(drawV2).call{value: 5 ether}("");
        assertTrue(ok, "receive()");
        fulfillTo(address(drawV2), req, WORD[6]);
        (, uint256 bP) = drawV2.spinPrize(id);
        assertEq(bP, 0, "bonus snapshotted at entry");
        assertEq(drawV2.availableBnb(), 5 ether);
    }

    // ---------------------------------------------------------------- VRF
    function test_RetryKeepsReservationAndInvalidatesOld() public {
        (uint256 id, uint256 oldReq) = _enter(alice, 10_000e18);
        uint256 res = drawV2.reservedTwak();
        vm.expectRevert(DrawV2.TooEarly.selector);
        drawV2.retrySpin{value: drawFee}(id);
        vm.warp(block.timestamp + 1 hours);
        uint256 newReq = drawV2.retrySpin{value: drawFee}(id);
        assertEq(drawV2.reservedTwak(), res, "reservation kept");
        assertEq(drawV2.spinOfRequest(oldReq), 0);
        fulfillTo(address(drawV2), oldReq, WORD[6]); // stale: ignored
        (, uint8 status,,,,,,) = _spin(id);
        assertEq(status, 1);
        assertEq(drawV2.reservedTwak(), res);
        fulfillTo(address(drawV2), newReq, WORD[2]);
        (, status,,,,,,) = _spin(id);
        (uint256 tP,) = drawV2.spinPrize(id);
        assertEq(status, 2);
        assertEq(tP, 10_000e18);
        assertEq(drawV2.reservedTwak(), 0);
        _rawFulfil(drawV2, newReq, WORD[6]); // double fulfil (mock already deleted it): ignored
        assertEq(drawV2.owedTwak(alice), 10_000e18);
        vm.expectRevert(DrawV2.NotPending.selector);
        drawV2.retrySpin{value: drawFee}(id);
    }

    function test_OnlyVRFWrapperCanFulfillCanFulfil() public {
        _enter(alice, 1_000e18);
        uint256[] memory w = new uint256[](1);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.OnlyVRFWrapperCanFulfill.selector, address(this), address(vrf)));
        drawV2.rawFulfillRandomWords(1, w);
    }

    function test_CallbackGasUnderLimit() public {
        vm.deal(address(drawV2), 1 ether);
        (, uint256 req) = _enter(alice, 1_000e18);
        uint256[] memory w = new uint256[](1);
        w[0] = WORD[6];
        vm.cool(address(drawV2));
        vm.cool(address(token));
        vm.prank(address(vrf));
        uint256 g = gasleft();
        drawV2.rawFulfillRandomWords(req, w);
        g -= gasleft();
        emit log_named_uint("fulfil gas (first jackpot, cold slots)", g);
        assertLt(g, 150_000);
    }

    // ---------------------------------------------------------------- owner / binding
    function test_OwnerCannotWithdraw() public {
        vm.deal(address(drawV2), 3 ether);
        _enter(alice, 1_000e18);
        bytes4[6] memory sels = [
            bytes4(keccak256("withdraw()")),
            bytes4(keccak256("withdraw(uint256)")),
            bytes4(keccak256("withdrawBnb(uint256)")),
            bytes4(keccak256("withdrawTokens(address,uint256)")),
            bytes4(keccak256("sweep(address)")),
            bytes4(keccak256("rescue(address,uint256)"))
        ];
        for (uint256 i; i < sels.length; ++i) {
            vm.prank(address(timelock));
            (bool ok,) = address(drawV2).call(abi.encodeWithSelector(sels[i], address(timelock), 1));
            assertFalse(ok);
        }
        assertEq(address(drawV2).balance, 3 ether);
        assertEq(token.balanceOf(address(drawV2)), POOL + 1_000e18);
    }

    function test_PauseOnlyBlocksNewEntries() public {
        (, uint256 req) = _enter(alice, 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        drawV2.setEntriesPaused(true);
        vm.prank(address(timelock));
        drawV2.setEntriesPaused(true);
        vm.prank(bob);
        vm.expectRevert(DrawV2.EntriesPaused.selector);
        drawV2.enter{value: drawFee}(1_000e18);
        fulfillTo(address(drawV2), req, WORD[3]);
        vm.prank(alice);
        drawV2.claim();
        assertEq(drawV2.outstandingTwak(), 0);
    }

    function test_FixtureBindingStillRequires70M() public {
        assertEq(address(drawV2.token()), address(token));
        assertEq(drawV2.PRIZE_ALLOCATION(), 70_000_000e18);
        vm.expectRevert(TokenBound.AlreadyBound.selector);
        drawV2.bindToken(address(token));
        DrawV2 fresh = _newPool(address(0));
        vm.expectRevert(abi.encodeWithSelector(TokenBound.BadAllocation.selector, 0, 70_000_000e18));
        fresh.bindToken(address(token));
        vm.expectRevert(TokenBound.NotBound.selector);
        fresh.enter{value: drawFee}(100e18);
    }

    function test_StandalonePresetAndSeed() public {
        DrawV2 d = _newPool(address(token));
        vm.expectRevert(TokenBound.AlreadyBound.selector);
        d.bindToken(address(token));
        vm.startPrank(seasons);
        token.approve(address(d), 5_000_000e18);
        vm.expectRevert(DrawV2.ZeroAmount.selector);
        d.seed(0);
        vm.expectEmit(true, false, false, true, address(d));
        emit DrawV2.PoolSeeded(seasons, 5_000_000e18);
        d.seed(5_000_000e18);
        vm.stopPrank();
        assertEq(d.availableTwak(), 5_000_000e18);
        assertEq(d.maxEntry(), 25_000e18, "0.5% of 5M");
        assertEq(d.totalSeeded(), 5_000_000e18);
    }

    function test_EventsOnEnterAssignClaim() public {
        vm.deal(address(drawV2), 1 ether);
        vm.expectEmit(true, true, false, true, address(drawV2));
        emit DrawV2.Entered(1, alice, 1_000e18, 10_000e18, 0.02 ether);
        vm.expectEmit(true, true, false, false, address(drawV2));
        emit DrawV2.SpinRequested(1, 1);
        _enter(alice, 1_000e18);
        vm.expectEmit(true, true, false, true, address(drawV2));
        emit DrawV2.SpinAssigned(1, alice, 5, 5_000e18, 0.01 ether);
        fulfillTo(address(drawV2), 1, WORD[5]);
        vm.expectEmit(true, false, false, true, address(drawV2));
        emit DrawV2.Claimed(alice, 5_000e18, 0.01 ether);
        vm.prank(alice);
        drawV2.claim();
        assertEq(drawV2.lastSpinOf(alice), 1);
    }

    // ---------------------------------------------------------------- fuzz: random flow
    /// Random enters (players / amounts), out-of-order fulfils, BNB inflows and claims. After every step:
    ///   balance >= reserved + outstanding (TWAK and BNB), seed + entries == balance + claimed,
    ///   assigned == claimed + outstanding, each spin's prize <= 10 x entry and <= its booked BNB cap.
    function testFuzz_RandomFlowSolvent(uint256 salt, uint96 seedAmt, uint96 bnbIn) public {
        uint256 s0 = bound(seedAmt, 20_000e18, 20_000_000e18);
        uint256 bnb0 = bound(bnbIn, 0, 200 ether);
        DrawV2 d = _newPool(address(token));
        vm.startPrank(seasons);
        token.approve(address(d), s0);
        d.seed(s0);
        vm.stopPrank();
        vm.deal(address(d), bnb0);
        uint256 bnbTotalIn = bnb0;
        address[3] memory ps = [alice, bob, seasons];
        for (uint256 i; i < 3; ++i) {
            vm.prank(ps[i]);
            token.approve(address(d), type(uint256).max);
        }

        uint256[] memory pending = new uint256[](40);
        uint256 np;
        uint256 bookedMaxTwak;
        uint256 bookedMaxBnb;
        for (uint256 step; step < 40; ++step) {
            uint256 r = uint256(keccak256(abi.encode(salt, step)));
            uint256 action = r % 4;
            if (action <= 1) {
                uint256 maxE = d.maxEntry();
                if (maxE >= 100e18) {
                    address p = ps[(r >> 8) % 3];
                    uint256 amt = bound(r >> 16, 100e18, maxE);
                    if (token.balanceOf(p) >= amt) {
                        vm.prank(p);
                        (uint256 id,) = d.enter{value: drawFee}(amt);
                        (,,,,, uint256 tRes, uint256 bRes,) = d.spins(id);
                        assertEq(tRes, amt * 10);
                        bookedMaxTwak += tRes;
                        bookedMaxBnb += bRes;
                        pending[np++] = id;
                    }
                }
            } else if (action == 2 && np > 0) {
                uint256 k = (r >> 8) % np;
                uint256 id = pending[k];
                pending[k] = pending[--np];
                (,,,, uint256 amt,, uint256 bRes, uint256 req) = d.spins(id);
                fulfillTo(address(d), req, r >> 32);
                (uint256 tP, uint256 bP) = d.spinPrize(id);
                assertLe(tP, amt * 10, "<= 10x entry");
                assertLe(bP, bRes, "<= booked BNB cap");
            } else if (action == 3) {
                if ((r >> 8) % 2 == 0) {
                    uint256 add = (r >> 16) % 5 ether;
                    vm.deal(address(this), add);
                    (bool ok,) = address(d).call{value: add}("");
                    assertTrue(ok);
                    bnbTotalIn += add;
                } else {
                    address p = ps[(r >> 16) % 3];
                    if (d.owedTwak(p) > 0 || d.owedBnb(p) > 0) {
                        vm.prank(p);
                        d.claim();
                    }
                }
            }
            _solvent(d);
            uint256 bal = token.balanceOf(address(d));
            assertEq(s0 + d.totalEntered(), bal + d.totalClaimedTwak(), "TWAK conserved");
            assertEq(bnbTotalIn, address(d).balance + d.totalClaimedBnb(), "BNB conserved");
            assertEq(d.totalAssignedTwak(), d.totalClaimedTwak() + d.outstandingTwak());
            assertEq(d.totalAssignedBnb(), d.totalClaimedBnb() + d.outstandingBnb());
            assertLe(d.totalAssignedTwak() + d.reservedTwak(), bookedMaxTwak, "paid + reserved <= booked maxes");
            assertLe(d.totalAssignedBnb() + d.reservedBnb(), bookedMaxBnb);
        }
        // drain: fulfil everything, everyone claims, all locks release
        for (uint256 k; k < np; ++k) {
            (,,,,,,, uint256 req) = d.spins(pending[k]);
            fulfillTo(address(d), req, uint256(keccak256(abi.encode(salt, "drain", k))));
        }
        for (uint256 i; i < 3; ++i) {
            if (d.owedTwak(ps[i]) > 0 || d.owedBnb(ps[i]) > 0) {
                vm.prank(ps[i]);
                d.claim();
            }
        }
        assertEq(d.reservedTwak(), 0);
        assertEq(d.outstandingTwak(), 0);
        assertEq(d.reservedBnb(), 0);
        assertEq(d.outstandingBnb(), 0);
        assertEq(d.availableTwak(), token.balanceOf(address(d)));
        assertEq(s0 + d.totalEntered(), token.balanceOf(address(d)) + d.totalClaimedTwak());
    }

    receive() external payable override {}
}

/// @dev Handler for the stateful invariant run: its own VRF mock (so it may fulfil) and a stand-alone pool.
contract DrawV2Handler is Test {
    IERC20 public token;
    VRFWrapperMock public vrf;
    DrawV2 public d;
    address[3] public players;
    uint256[] public pending;
    uint256 public bnbIn;
    uint256 public bookedTwak;
    uint256 public bookedBnb;
    uint256 public maxOverTenX; // must stay 0
    uint256 public fee; // buffered VRF fee quote at 1 gwei (excess over the wrapper price is refunded)
    uint256 public callbackFailures; // live-request fulfils that did not assign (revert / OOG): must stay 0

    constructor(IERC20 token_) {
        token = token_;
        vrf = new VRFWrapperMock();
        d = new DrawV2(
            address(0xBEEF),
            address(token_),
            VRFConsumerV25.VRFConfig({
                wrapper: address(vrf),
                requestConfirmations: 3,
                callbackGasLimit: 200_000 // production DrawV2 limit
            })
        );
        fee = d.vrfFeeAt(1 gwei);
        for (uint256 i; i < 3; ++i) {
            players[i] = address(uint160(0xA11CE0 + i));
        }
    }

    function seedPool(uint256 amt) external {
        token.approve(address(d), amt);
        d.seed(amt);
    }

    function fundPlayers(uint256 each) external {
        for (uint256 i; i < 3; ++i) {
            token.transfer(players[i], each);
            vm.prank(players[i]);
            token.approve(address(d), type(uint256).max);
        }
    }

    function enter(uint256 who, uint256 amt) external {
        uint256 maxE = d.maxEntry();
        if (maxE < 100e18) return;
        address p = players[who % 3];
        amt = bound(amt, 100e18, maxE);
        if (token.balanceOf(p) < amt) return;
        vm.deal(p, fee);
        vm.txGasPrice(1 gwei);
        vm.prank(p);
        (uint256 id,) = d.enter{value: fee}(amt);
        (,,,,, uint256 tRes, uint256 bRes,) = d.spins(id);
        bookedTwak += tRes;
        bookedBnb += bRes;
        pending.push(id);
    }

    function fulfil(uint256 k, uint256 word) external {
        if (pending.length == 0) return;
        k %= pending.length;
        uint256 id = pending[k];
        pending[k] = pending[pending.length - 1];
        pending.pop();
        (,,,, uint256 amt,,, uint256 req) = d.spins(id);
        _fulfil(req, word);
        (, uint8 st,,,,,,) = d.spins(id);
        if (st != 2) ++callbackFailures;
        (uint256 tP,) = d.spinPrize(id);
        if (tP > amt * 10) maxOverTenX = tP;
    }

    function retry(uint256 k, uint256 word) external {
        if (pending.length == 0) return;
        uint256 id = pending[k % pending.length];
        (,,, uint64 at,,,, uint256 oldReq) = d.spins(id);
        vm.warp(uint256(at) + 1 hours);
        vm.deal(address(this), fee);
        vm.txGasPrice(1 gwei);
        d.retrySpin{value: fee}(id);
        _fulfil(oldReq, word); // stale fulfil must be a no-op
    }

    function _fulfil(uint256 req, uint256 word) internal {
        uint256[] memory w = new uint256[](1);
        w[0] = word;
        (address c,,,,) = vrf.callbacks(req);
        if (c == address(0)) return;
        vrf.fulfillWords(req, w);
    }

    function claim(uint256 who) external {
        address p = players[who % 3];
        if (d.owedTwak(p) == 0 && d.owedBnb(p) == 0) return;
        vm.prank(p);
        d.claim();
    }

    function addBnb(uint256 amt) external {
        amt = bound(amt, 0, 10 ether);
        vm.deal(address(this), amt);
        (bool ok,) = address(d).call{value: amt}("");
        require(ok);
        bnbIn += amt;
    }

    receive() external payable {} // retrySpin refunds the unused fee buffer
}

contract DrawV2InvariantTest is Fixture {
    DrawV2Handler h;

    function setUp() public override {
        super.setUp();
        h = new DrawV2Handler(token);
        vm.prank(seasons);
        token.transfer(address(h), 20_000_000e18);
        // 5M pool (the testnet seed size) and 5M per player
        h.seedPool(5_000_000e18);
        h.fundPlayers(5_000_000e18);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](5);
        sels[0] = DrawV2Handler.enter.selector;
        sels[1] = DrawV2Handler.fulfil.selector;
        sels[2] = DrawV2Handler.retry.selector;
        sels[3] = DrawV2Handler.claim.selector;
        sels[4] = DrawV2Handler.addBnb.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    function invariant_Solvent() public view {
        DrawV2 d = h.d();
        assertGe(token.balanceOf(address(d)), d.reservedTwak() + d.outstandingTwak());
        assertGe(address(d).balance, d.reservedBnb() + d.outstandingBnb());
    }

    function invariant_Conserved() public view {
        DrawV2 d = h.d();
        assertEq(d.totalSeeded() + d.totalEntered(), token.balanceOf(address(d)) + d.totalClaimedTwak());
        assertEq(h.bnbIn(), address(d).balance + d.totalClaimedBnb());
        assertEq(d.totalAssignedTwak(), d.totalClaimedTwak() + d.outstandingTwak());
        assertEq(d.totalAssignedBnb(), d.totalClaimedBnb() + d.outstandingBnb());
    }

    function invariant_BoundedByBookedMaxes() public view {
        DrawV2 d = h.d();
        assertLe(d.totalAssignedTwak() + d.reservedTwak(), h.bookedTwak());
        assertLe(d.totalAssignedBnb() + d.reservedBnb(), h.bookedBnb());
        assertEq(h.maxOverTenX(), 0);
        assertEq(h.callbackFailures(), 0);
    }
}
