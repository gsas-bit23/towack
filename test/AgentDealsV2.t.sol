// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {AgentDealsV2} from "../src/AgentDealsV2.sol";
import {MockHandleRegistry, MockUSDT} from "./AgentDeals.t.sol";

contract AgentDealsV2Test is Fixture {
    AgentDealsV2 deals;
    MockHandleRegistry reg;
    MockUSDT usdt;

    address provider = makeAddr("provider");
    address client = makeAddr("client");
    address treasury = makeAddr("treasury");
    address noAgent = makeAddr("noAgent");
    uint256 clientId;

    uint64 constant WINDOW = 2 days;
    bytes32 constant TERMS = keccak256("write a market summary");
    bytes32 constant DELIVERY = keccak256("ipfs://summary");

    function setUp() public override {
        super.setUp();
        reg = new MockHandleRegistry();
        usdt = new MockUSDT();
        reg.register(provider, "builder");
        clientId = reg.register(client, "buyer");
        deals = new AgentDealsV2(address(reg), address(token), address(usdt), treasury, address(drawV2));

        usdt.mint(client, 1_000_000e18);
        vm.prank(seasons);
        token.transfer(client, 10_000_000e18);
        vm.startPrank(client);
        usdt.approve(address(deals), type(uint256).max);
        token.approve(address(deals), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers
    function _judge(uint256 i) internal returns (address j) {
        j = makeAddr(string.concat("judge", vm.toString(i)));
        if (reg.balanceOf(j) == 0) reg.register(j, string.concat("judge", vm.toString(i)));
    }

    function _delivered(address tok, uint256 amount) internal returns (uint256 id) {
        vm.prank(provider);
        id = deals.createOffer(tok, amount, clientId, WINDOW, TERMS);
        vm.prank(client);
        deals.accept(id);
        vm.prank(provider);
        deals.deliver(id, DELIVERY);
    }

    function _salt(address j) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", j));
    }

    function _commit(uint256 id, address j, bool pass) internal {
        bytes32 c = deals.voteCommitment(id, j, pass, _salt(j));
        vm.prank(j);
        deals.commitVote(id, c);
    }

    function _reveal(uint256 id, address j, bool pass) internal {
        vm.prank(j);
        deals.revealVote(id, pass, _salt(j));
    }

    /// Commits `passN` PASS and `failN` FAIL judges (judge indexes from `start`), then reveals them all.
    function _jury(uint256 id, uint256 start, uint256 passN, uint256 failN) internal {
        for (uint256 i = 0; i < passN + failN; i++) {
            _commit(id, _judge(start + i), i < passN);
        }
        vm.warp(block.timestamp + 48 hours);
        for (uint256 i = 0; i < passN + failN; i++) {
            _reveal(id, _judge(start + i), i < passN);
        }
        vm.warp(block.timestamp + 24 hours);
    }

    function _status(uint256 id) internal view returns (AgentDealsV2.Status s) {
        (,,,,,,,,,, s) = deals.deals(id);
    }

    // ---------------------------------------------------------------- verdicts
    function test_PassVerdict_PaysProvider_FeesAndPassJudges() public {
        uint256 id = _delivered(address(usdt), 1_000e18);
        _jury(id, 0, 3, 1);
        deals.finalize(id); // anyone can finalize

        assertEq(uint8(_status(id)), uint8(AgentDealsV2.Status.Paid));
        assertEq(usdt.balanceOf(provider), 985e18); // 100% - 1% fee - 0.5% judges
        uint256 share = uint256(5e18) / 3;
        for (uint256 i = 0; i < 3; i++) {
            assertEq(deals.claimable(id, _judge(i)), share);
            vm.prank(_judge(i));
            deals.claimJudgeReward(id);
            assertEq(usdt.balanceOf(_judge(i)), share);
        }
        assertEq(deals.claimable(id, _judge(3)), 0, "losing FAIL judge gets nothing");
        vm.prank(_judge(3));
        vm.expectRevert(AgentDealsV2.NothingToClaim.selector);
        deals.claimJudgeReward(id);
        // Rounding dust went to the treasury at settlement, so nothing is left behind.
        assertEq(usdt.balanceOf(address(deals)), 0);
        assertEq(usdt.balanceOf(treasury), 10e18 + (5e18 - share * 3));
        (,,, AgentDealsV2.Verdict v,,) = deals.juries(id);
        assertEq(uint8(v), uint8(AgentDealsV2.Verdict.Pass));
        assertEq(deals.dealsJudged(), 1);
    }

    function test_FailVerdict_RefundsClient_FailJudgesPaid_NoProtocolFee() public {
        uint256 id = _delivered(address(usdt), 1_000e18);
        uint256 before = usdt.balanceOf(client);
        _jury(id, 0, 1, 3);
        deals.finalize(id);

        assertEq(uint8(_status(id)), uint8(AgentDealsV2.Status.Refunded));
        assertEq(usdt.balanceOf(client) - before, 995e18);
        assertEq(usdt.balanceOf(provider), 0);
        assertEq(usdt.balanceOf(treasury), 5e18 - (uint256(5e18) / 3) * 3); // only rounding dust
        assertEq(deals.claimable(id, _judge(0)), 0, "losing PASS judge gets nothing");
        for (uint256 i = 1; i < 4; i++) {
            assertEq(deals.claimable(id, _judge(i)), uint256(5e18) / 3);
        }
    }

    function test_NoQuorum_IsPass_EvenIfAllFail_ProviderKeepsJudgeShare() public {
        uint256 id = _delivered(address(usdt), 1_000e18);
        _jury(id, 0, 0, 2); // 2 FAIL < quorum of 3
        deals.finalize(id);
        assertEq(uint8(_status(id)), uint8(AgentDealsV2.Status.Paid));
        assertEq(usdt.balanceOf(provider), 990e18); // no PASS judges → no judge fee
        assertEq(deals.claimable(id, _judge(0)), 0);
    }

    function test_TwoThirdsBoundary() public {
        assertTrue(deals.isFailVerdict(2, 4)); // 4/6 = 2/3 → FAIL
        assertFalse(deals.isFailVerdict(2, 3)); // 3/5 < 2/3 → PASS
        assertTrue(deals.isFailVerdict(0, 3));
        assertFalse(deals.isFailVerdict(0, 2)); // no quorum
        assertTrue(deals.isFailVerdict(1, 2)); // 2/3 of 3
        assertFalse(deals.isFailVerdict(10, 19)); // 19/29 < 2/3
        assertTrue(deals.isFailVerdict(10, 20));
    }

    function test_UnrevealedCommit_DoesNotCount_AndEarnsNothing() public {
        uint256 id = _delivered(address(usdt), 1_000e18);
        for (uint256 i = 0; i < 4; i++) {
            _commit(id, _judge(i), false);
        }
        vm.warp(block.timestamp + 48 hours);
        for (uint256 i = 0; i < 2; i++) {
            _reveal(id, _judge(i), false); // only 2 of 4 reveal → no quorum
        }
        vm.warp(block.timestamp + 24 hours);
        deals.finalize(id);
        assertEq(uint8(_status(id)), uint8(AgentDealsV2.Status.Paid));
        assertEq(deals.claimable(id, _judge(3)), 0);
    }

    function test_TwakPass_SeedsDrawV2_AndPaysJudgesInTwak() public {
        uint256 poolBefore = token.balanceOf(address(drawV2));
        uint256 id = _delivered(address(token), 100_000e18);
        _jury(id, 0, 4, 0);
        deals.finalize(id);
        assertEq(token.balanceOf(provider), 98_500e18);
        assertEq(token.balanceOf(treasury), 800e18);
        assertEq(token.balanceOf(address(drawV2)) - poolBefore, 200e18);
        assertEq(deals.claimable(id, _judge(0)), 125e18); // 500 TWAK / 4
        assertEq(token.allowance(address(deals), address(drawV2)), 0);
    }

    function test_ManyJudges_BatchClaim() public {
        uint256 id1 = _delivered(address(usdt), 10_000e18);
        uint256 id2 = _delivered(address(usdt), 10_000e18);
        for (uint256 i = 0; i < 60; i++) {
            _commit(id1, _judge(i), true);
            _commit(id2, _judge(i), true);
        }
        vm.warp(block.timestamp + 48 hours);
        for (uint256 i = 0; i < 60; i++) {
            _reveal(id1, _judge(i), true);
            _reveal(id2, _judge(i), true);
        }
        vm.warp(block.timestamp + 24 hours);
        deals.finalize(id1);
        deals.finalize(id2);
        uint256[] memory ids = new uint256[](2);
        ids[0] = id1;
        ids[1] = id2;
        vm.prank(_judge(7));
        uint256 got = deals.claimJudgeRewards(ids);
        assertEq(got, 2 * (uint256(50e18) / 60));
        vm.prank(_judge(7));
        vm.expectRevert(AgentDealsV2.NothingToClaim.selector);
        deals.claimJudgeRewards(ids);
    }

    // ---------------------------------------------------------------- client release during the jury
    function test_ReleaseDuringReveal_PaysRevealedPassJudges() public {
        uint256 id = _delivered(address(usdt), 1_000e18);
        _commit(id, _judge(0), true);
        _commit(id, _judge(1), false);
        _commit(id, _judge(2), true);
        vm.warp(block.timestamp + 48 hours);
        _reveal(id, _judge(0), true);
        _reveal(id, _judge(1), false);
        vm.prank(client);
        deals.release(id);
        assertEq(usdt.balanceOf(provider), 985e18);
        assertEq(deals.claimable(id, _judge(0)), 5e18); // only revealed PASS judge
        assertEq(deals.claimable(id, _judge(1)), 0);
        assertEq(deals.claimable(id, _judge(2)), 0); // never revealed
        address j2 = _judge(2);
        bytes32 s2 = _salt(j2);
        vm.prank(j2);
        vm.expectRevert(abi.encodeWithSelector(AgentDealsV2.WrongStatus.selector, AgentDealsV2.Status.Paid));
        deals.revealVote(id, true, s2);
    }

    function test_ReleaseBeforeAnyVote_NoJudgeFee() public {
        uint256 id = _delivered(address(usdt), 100e18);
        vm.prank(client);
        deals.release(id);
        assertEq(usdt.balanceOf(provider), 99e18);
    }

    // ---------------------------------------------------------------- judge rules
    function test_PartiesAndNonAgentsCannotJudge() public {
        uint256 id = _delivered(address(usdt), 100e18);
        vm.prank(provider);
        vm.expectRevert(AgentDealsV2.PartyCannotJudge.selector);
        deals.commitVote(id, bytes32(uint256(1)));
        vm.prank(client);
        vm.expectRevert(AgentDealsV2.PartyCannotJudge.selector);
        deals.commitVote(id, bytes32(uint256(1)));
        vm.prank(noAgent);
        vm.expectRevert(AgentDealsV2.NoAgentId.selector);
        deals.commitVote(id, bytes32(uint256(1)));
    }

    function test_CommitRevealTiming_AndBadReveal() public {
        uint256 id = _delivered(address(usdt), 100e18);
        address j = _judge(0);
        _commit(id, j, true);
        vm.prank(j);
        vm.expectRevert(AgentDealsV2.AlreadyCommitted.selector);
        deals.commitVote(id, bytes32(uint256(2)));
        vm.prank(j);
        vm.expectRevert(AgentDealsV2.TooEarly.selector);
        deals.revealVote(id, true, _salt(j));

        vm.warp(block.timestamp + 48 hours);
        address late = _judge(1);
        bytes32 c = deals.voteCommitment(id, late, true, _salt(late));
        vm.prank(late);
        vm.expectRevert(AgentDealsV2.TooLate.selector);
        deals.commitVote(id, c);

        vm.prank(j);
        vm.expectRevert(AgentDealsV2.BadReveal.selector);
        deals.revealVote(id, false, _salt(j)); // different vote than committed
        vm.prank(late);
        vm.expectRevert(AgentDealsV2.NoCommit.selector);
        deals.revealVote(id, true, _salt(late));
        _reveal(id, j, true);
        vm.prank(j);
        vm.expectRevert(AgentDealsV2.AlreadyRevealed.selector);
        deals.revealVote(id, true, _salt(j));

        vm.expectRevert(AgentDealsV2.TooEarly.selector);
        deals.finalize(id);
        vm.warp(block.timestamp + 24 hours);
        address j2 = _judge(2);
        bytes32 s2 = _salt(j2);
        vm.prank(j2);
        vm.expectRevert(AgentDealsV2.TooLate.selector);
        deals.revealVote(id, true, s2);
        deals.finalize(id);
        vm.expectRevert(abi.encodeWithSelector(AgentDealsV2.WrongStatus.selector, AgentDealsV2.Status.Paid));
        deals.finalize(id);
    }

    function test_CopiedCommitment_CannotBeRevealedByAnotherJudge() public {
        uint256 id = _delivered(address(usdt), 100e18);
        address a = _judge(0);
        address b = _judge(1);
        bytes32 c = deals.voteCommitment(id, a, true, _salt(a));
        vm.prank(a);
        deals.commitVote(id, c);
        vm.prank(b);
        deals.commitVote(id, c); // b copies a's sealed vote
        vm.warp(block.timestamp + 48 hours);
        vm.prank(b);
        vm.expectRevert(AgentDealsV2.BadReveal.selector);
        deals.revealVote(id, true, _salt(a)); // commitment binds the judge address
    }

    function test_CannotJudgeUndeliveredDeal() public {
        vm.prank(provider);
        uint256 id = deals.createOffer(address(usdt), 100e18, clientId, WINDOW, TERMS);
        address j = _judge(0);
        vm.prank(j);
        vm.expectRevert(abi.encodeWithSelector(AgentDealsV2.WrongStatus.selector, AgentDealsV2.Status.Open));
        deals.commitVote(id, bytes32(uint256(1)));
    }

    // ---------------------------------------------------------------- refunds
    function test_ProviderRefund_AllowedDuringCommit_BlockedFromReveal() public {
        uint256 id = _delivered(address(usdt), 100e18);
        uint256 before = usdt.balanceOf(client);
        vm.warp(block.timestamp + 47 hours);
        vm.prank(provider);
        deals.refundByProvider(id);
        assertEq(usdt.balanceOf(client) - before, 100e18);

        uint256 id2 = _delivered(address(usdt), 100e18);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(provider);
        vm.expectRevert(AgentDealsV2.TooLate.selector);
        deals.refundByProvider(id2);
    }

    function test_DeadlineRefund_NoFee_AndJuryNeverOpens() public {
        vm.prank(provider);
        uint256 id = deals.createOffer(address(usdt), 500e18, clientId, WINDOW, TERMS);
        vm.prank(client);
        deals.accept(id);
        uint256 bal = usdt.balanceOf(client);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(client);
        deals.refund(id);
        assertEq(usdt.balanceOf(client), bal + 500e18);
        assertEq(deals.juryPhase(id), 4);
    }

    function test_JuryPhase() public {
        uint256 id = _delivered(address(usdt), 100e18);
        assertEq(deals.juryPhase(id), 1);
        vm.warp(block.timestamp + 48 hours);
        assertEq(deals.juryPhase(id), 2);
        vm.warp(block.timestamp + 24 hours);
        assertEq(deals.juryPhase(id), 3);
        deals.finalize(id);
        assertEq(deals.juryPhase(id), 4);
    }

    // ---------------------------------------------------------------- fuzz: conservation
    /// Whatever the votes, every wei ends up with the provider, client, treasury, Draw V2 or a winning judge.
    function testFuzz_Conservation(uint96 rawAmount, uint8 rawPass, uint8 rawFail, bool twak) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000e18);
        uint256 passN = bound(uint256(rawPass), 0, 12);
        uint256 failN = bound(uint256(rawFail), 0, 12);
        address tok = twak ? address(token) : address(usdt);
        uint256 clientBefore = _bal(tok, client);
        uint256 drawBefore = _bal(tok, address(drawV2));

        uint256 id = _delivered(tok, amount);
        _jury(id, 0, passN, failN);
        deals.finalize(id);
        uint256 judgesTotal;
        for (uint256 i = 0; i < passN + failN; i++) {
            address j = _judge(i);
            if (deals.claimable(id, j) > 0) {
                vm.prank(j);
                judgesTotal += deals.claimJudgeReward(id);
            }
        }
        uint256 paidOut = _bal(tok, provider) + (_bal(tok, client) - (clientBefore - amount)) + _bal(tok, treasury)
            + (_bal(tok, address(drawV2)) - drawBefore) + judgesTotal;
        assertEq(paidOut, amount, "conservation");
        assertEq(_bal(tok, address(deals)), 0, "nothing stuck");
        bool fail = deals.isFailVerdict(passN, failN);
        assertEq(uint8(_status(id)), uint8(fail ? AgentDealsV2.Status.Refunded : AgentDealsV2.Status.Paid));
    }

    function _bal(address tok, address who) internal view returns (uint256) {
        return tok == address(token) ? token.balanceOf(who) : usdt.balanceOf(who);
    }
}
