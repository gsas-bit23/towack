// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Exposes the Genesis deck walk without VRF / minting, for the fuzz invariant.
contract GenesisDeckHarness is TowackGenesis {
    constructor(address t, address a, address e, VRFConfig memory c) TowackGenesis(t, a, e, msg.sender, c) {}

    function draw(uint256 word) external returns (uint8) {
        return _drawFromDeck(word);
    }
}

contract TowackGenesisTest is Fixture {
    TowackGenesis genesis;
    MockAgentIdNFT nft;

    uint256 constant BASE = 20_000e18;
    uint256 constant BUDGET = 8_000_000e18;
    uint256[7] FULL = [uint256(5), 10, 20, 40, 50, 75, 100];
    uint256[7] EXTRA = [uint256(80_000e18), 40_000e18, 20_000e18, 10_000e18, 5_000e18, 2_000e18, 0];

    function setUp() public override {
        super.setUp();
        nft = new MockAgentIdNFT();
        genesis = new TowackGenesis(address(token), address(nft), ecosystem, address(this), vrfCfg());
        vrf.addConsumer(subId, address(genesis));
    }

    // ---------------------------------------------------------------- helpers
    function gUser(uint256 i) internal pure returns (address) {
        return address(uint160(0x900000 + i));
    }

    function _fund(uint256 amt) internal {
        vm.startPrank(ecosystem);
        token.approve(address(genesis), amt);
        genesis.fund(amt);
        vm.stopPrank();
    }

    function _fundAndOpen() internal {
        _fund(BUDGET);
        genesis.open();
    }

    function _newHolder(uint256 i) internal returns (address u, uint256 id) {
        u = gUser(i);
        id = nft.registerFor(u);
    }

    function _mint(address u, uint256 id) internal {
        vm.prank(u);
        genesis.mint(id);
    }

    function _req(address u) internal view returns (uint256 id) {
        (,,,,,, id) = genesis.tickets(u);
    }

    function _mintN(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            (address u, uint256 id) = _newHolder(i);
            _mint(u, id);
        }
    }

    function _fulfillN(uint256 n, uint256 salt) internal {
        for (uint256 i; i < n; ++i) {
            fulfillTo(address(genesis), _req(gUser(i)), wordFor(salt, i));
        }
    }

    function _assertSolvent() internal view {
        assertGe(token.balanceOf(address(genesis)), genesis.committed(), "solvent");
        assertGe(token.balanceOf(address(genesis)), genesis.extraOutstanding(), "outstanding covered");
        assertLe(genesis.totalAssigned(), BUDGET, "<= 8M");
    }

    // ---------------------------------------------------------------- constants / table
    function test_DeckTableTotals() public {
        uint256 slots;
        uint256 extra;
        for (uint8 k; k < 7; ++k) {
            assertEq(genesis.prizeSlots(k), FULL[k]);
            assertEq(genesis.prizeExtra(k), EXTRA[k]);
            slots += genesis.prizeSlots(k);
            extra += genesis.prizeSlots(k) * genesis.prizeExtra(k);
        }
        assertEq(slots, 300);
        assertEq(extra, 2_000_000e18);
        assertEq(genesis.BASE_TOTAL(), 6_000_000e18);
        assertEq(genesis.BUDGET(), BUDGET);
        assertEq(BUDGET * 100 / token.ECOSYSTEM(), 16, "16% of ecosystem");
        vm.expectRevert(bytes("tier"));
        genesis.prizeExtra(7);
    }

    // ---------------------------------------------------------------- window
    function test_MintRevertsBeforeOpenAndAfterClose() public {
        _fund(BUDGET);
        (address u, uint256 id) = _newHolder(0);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.NotOpen.selector);
        genesis.mint(id);

        genesis.open();
        genesis.close();
        vm.prank(u);
        vm.expectRevert(TowackGenesis.NotOpen.selector);
        genesis.mint(id);

        genesis.open();
        _mint(u, id);
        assertEq(genesis.mintCount(), 1);
    }

    function test_OnlyOwnerOpensCloses() public {
        _fund(BUDGET);
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        genesis.open();
        genesis.open();
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        genesis.close();
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        genesis.sweepSurplus();
        vm.expectRevert(TowackGenesis.AlreadyOpen.selector);
        genesis.open();
    }

    function test_TimelockCanTakeOverOwnership() public {
        _fund(BUDGET);
        genesis.transferOwnership(address(timelock));
        assertEq(genesis.owner(), address(this), "2-step: pending only");
        vm.prank(address(timelock));
        genesis.acceptOwnership();
        assertEq(genesis.owner(), address(timelock));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        genesis.open();
        vm.prank(address(timelock));
        genesis.open();
        assertTrue(genesis.isOpen());
        vm.prank(address(timelock));
        genesis.close();
        assertFalse(genesis.isOpen());
    }

    function test_RenounceDisabled() public {
        vm.expectRevert(TowackGenesis.RenounceDisabled.selector);
        genesis.renounceOwnership();
    }

    // ---------------------------------------------------------------- gate
    function test_NonHolderReverts() public {
        _fundAndOpen();
        address noNft = makeAddr("noNft");
        // nonexistent token id
        vm.prank(noNft);
        vm.expectRevert(TowackGenesis.NotAgentOwner.selector);
        genesis.mint(999);
        // someone else's token id
        (, uint256 id) = _newHolder(0);
        vm.prank(noNft);
        vm.expectRevert(TowackGenesis.NotAgentOwner.selector);
        genesis.mint(id);
    }

    function test_DoubleClaim_SameWalletSameToken() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        genesis.mint(id);
    }

    function test_DoubleClaim_WalletWithSecondToken() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        uint256 id2 = nft.registerFor(u);
        _mint(u, id);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        genesis.mint(id2);
    }

    function test_DoubleClaim_TokenTransferredToFreshWallet() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        address fresh = makeAddr("fresh");
        vm.prank(u);
        nft.transferFrom(u, fresh, id);
        vm.prank(fresh);
        vm.expectRevert(TowackGenesis.TokenIdUsed.selector);
        genesis.mint(id);
        // the fresh wallet with its own unused id is fine
        uint256 own = nft.registerFor(fresh);
        _mint(fresh, own);
        assertEq(genesis.mintCount(), 2);
    }

    // ---------------------------------------------------------------- funding / solvency
    function test_UnderfundedCannotOpenOrMint() public {
        _fund(BUDGET - 1);
        vm.expectRevert(abi.encodeWithSelector(TowackGenesis.Underfunded.selector, BUDGET - 1, BUDGET));
        genesis.open();
        _fund(1);
        genesis.open();
        assertEq(genesis.surplus(), 0);
    }

    function test_FundOnlyPullsFromCaller_NoOtherPool() public {
        uint256 launchBal = token.balanceOf(address(launch));
        uint256 drawBal = token.balanceOf(address(drawV2));
        uint256 pairBal = token.balanceOf(token.pair());
        uint256 ecoBal = token.balanceOf(ecosystem);
        _fundAndOpen();
        _mintN(5);
        _fulfillN(5, 1);
        assertEq(token.balanceOf(address(launch)), launchBal);
        assertEq(token.balanceOf(address(drawV2)), drawBal);
        assertEq(token.balanceOf(token.pair()), pairBal);
        assertEq(token.balanceOf(ecosystem), ecoBal - BUDGET);
    }

    function test_NoBnbAccepted() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(genesis).call{value: 1 ether}("");
        assertFalse(ok, "plain BNB rejected");
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        vm.deal(u, 1 ether);
        vm.prank(u);
        (ok,) = address(genesis).call{value: 0.1 ether}(abi.encodeCall(TowackGenesis.mint, (id)));
        assertFalse(ok, "mint is not payable");
        assertEq(address(genesis).balance, 0);
    }

    function test_MintGivesBaseAndRequestsVrf() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        vm.expectEmit(true, true, true, true, address(genesis));
        emit TowackGenesis.GenesisMinted(u, 1, id, BASE);
        vm.recordLogs();
        _mint(u, id);
        VrfReq memory r = lastVrfRequest(vm.getRecordedLogs());
        assertEq(r.callbackGasLimit, CALLBACK_GAS);
        assertEq(r.subId, subId);
        assertEq(r.keyHash, KEY_HASH);
        assertEq(r.confirmations, 3);
        assertEq(r.sender, address(genesis));
        assertEq(token.balanceOf(u), BASE);
        uint256 req = _req(u);
        assertEq(genesis.requestMinter(req), u);

        // claim before assignment
        vm.prank(u);
        vm.expectRevert(TowackGenesis.NotAssigned.selector);
        genesis.claim();

        // word 0 -> pick 0 -> tier 0 (5x)
        vm.expectEmit(true, true, false, true, address(genesis));
        emit TowackGenesis.PrizeAssigned(u, 1, 0, 80_000e18);
        fulfillTo(address(genesis), req, 0);
        (bool minted, bool assigned, uint8 pid, uint256 extra, bool claimed) = genesis.prizeOf(u);
        assertTrue(minted && assigned && !claimed);
        assertEq(pid, 0);
        assertEq(extra, 80_000e18);

        vm.prank(u);
        genesis.claim();
        assertEq(token.balanceOf(u), 100_000e18, "5x = 100k total");
        vm.prank(u);
        vm.expectRevert(TowackGenesis.AlreadyClaimed.selector);
        genesis.claim();
        _assertSolvent();
    }

    function test_NoBonusNothingToClaim() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        fulfillTo(address(genesis), _req(u), 299); // last slot -> tier 6
        (,, uint8 pid,,) = genesis.prizeOf(u);
        assertEq(pid, 6);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.NothingToClaim.selector);
        genesis.claim();
    }

    function test_RetryAfterDelay_StaleIgnored() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        uint256 r1 = _req(u);
        vm.expectRevert(TowackGenesis.TooEarly.selector);
        genesis.retryPrize(u);
        vm.warp(block.timestamp + 1 hours);
        genesis.retryPrize(u);
        uint256 r2 = _req(u);
        assertTrue(r2 != r1);
        fulfillTo(address(genesis), r1, 0); // stale: ignored
        assertEq(genesis.assignedCount(), 0);
        fulfillTo(address(genesis), r2, 0);
        assertEq(genesis.assignedCount(), 1);
        vm.expectRevert(TowackGenesis.AlreadyAssigned.selector);
        genesis.retryPrize(u);
        vm.expectRevert(TowackGenesis.NotMinter.selector);
        genesis.retryPrize(makeAddr("nobody"));
    }

    function test_Cap_300Succeed_301stReverts_ContractEmptiesAfterClaims() public {
        uint256[11] memory launchDeck = launch.remainingCounts();
        uint256 launchBal = token.balanceOf(address(launch));
        _fundAndOpen();
        _mintN(300);
        assertEq(genesis.mintCount(), 300);
        assertFalse(genesis.isOpen(), "auto-closes at sellout");

        (address u301, uint256 id301) = _newHolder(300);
        vm.prank(u301);
        vm.expectRevert(TowackGenesis.NotOpen.selector);
        genesis.mint(id301);
        vm.expectRevert(TowackGenesis.SoldOut.selector);
        genesis.open();

        _fulfillN(300, 42);
        _assertSolvent();
        assertEq(genesis.remainingTotal(), 0);
        assertEq(genesis.totalAssigned(), BUDGET, "sellout assigns exactly 8M");
        assertEq(genesis.extraAssigned(), 2_000_000e18);
        assertEq(genesis.baseGranted(), 6_000_000e18);

        for (uint256 i; i < 300; ++i) {
            address u = gUser(i);
            (,,, uint256 extra,) = genesis.prizeOf(u);
            if (extra > 0) {
                vm.prank(u);
                genesis.claim();
            }
            _assertSolventCheap();
        }
        assertEq(token.balanceOf(address(genesis)), 0, "contract empty");
        assertEq(genesis.extraOutstanding(), 0);
        assertEq(address(genesis).balance, 0, "no BNB");

        // paid deck untouched
        uint256[11] memory after_ = launch.remainingCounts();
        for (uint256 k; k < 11; ++k) {
            assertEq(after_[k], launchDeck[k]);
        }
        assertEq(launch.remainingTotal(), 5000);
        assertEq(token.balanceOf(address(launch)), launchBal);
    }

    function _assertSolventCheap() internal view {
        assertGe(token.balanceOf(address(genesis)), genesis.extraOutstanding());
    }

    function test_EarlyClose_SweepOnlyUnassigned() public {
        _fundAndOpen();
        _mintN(10);
        _fulfillN(8, 7); // 2 still pending
        genesis.close();

        uint256 outstanding = genesis.extraOutstanding();
        uint256 bal = token.balanceOf(address(genesis));
        uint256 pendingWorst = 2 * 80_000e18;
        assertEq(genesis.committed(), outstanding + pendingWorst);
        uint256 ecoBefore = token.balanceOf(ecosystem);
        uint256 swept = genesis.sweepSurplus();
        assertEq(swept, bal - outstanding - pendingWorst);
        assertEq(token.balanceOf(ecosystem), ecoBefore + swept);
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();

        // pending draws and assigned prizes still pay out in full
        fulfillTo(address(genesis), _req(gUser(8)), wordFor(7, 8));
        fulfillTo(address(genesis), _req(gUser(9)), wordFor(7, 9));
        for (uint256 i; i < 10; ++i) {
            (,,, uint256 extra,) = genesis.prizeOf(gUser(i));
            if (extra > 0) {
                vm.prank(gUser(i));
                genesis.claim();
            }
        }
        assertEq(genesis.extraOutstanding(), 0);
        // the leftover worst-case reserve is now surplus too
        if (genesis.surplus() > 0) genesis.sweepSurplus();
        assertEq(token.balanceOf(address(genesis)), 0);
        assertEq(token.balanceOf(ecosystem), ecoBefore + bal - genesis.extraAssigned());

        // reopening requires refunding the remaining budget
        uint256 need = (300 - 10) * BASE + genesis.deckExtraRemaining();
        vm.expectRevert(abi.encodeWithSelector(TowackGenesis.Underfunded.selector, 0, need));
        genesis.open();
    }

    function test_SweepWhileOpenOnlyOverfund() public {
        _fund(BUDGET + 123e18);
        genesis.open();
        assertEq(genesis.surplus(), 123e18);
        assertEq(genesis.sweepSurplus(), 123e18);
        assertEq(genesis.surplus(), 0);
        _mintN(3);
        assertEq(genesis.surplus(), 0);
    }

    function test_CallbackGasWellUnderLimit() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        uint256 req = _req(u);
        uint256[] memory w = new uint256[](1);
        w[0] = 199; // last 1.1x slot: longest walk that still books extra (3 extra SSTOREs)
        vm.cool(address(genesis));
        vm.prank(address(vrf));
        uint256 g = gasleft();
        genesis.rawFulfillRandomWords(req, w);
        uint256 used = g - gasleft();
        emit log_named_uint("genesis callback gas (cold, worst walk with extra)", used);
        assertLt(used, 150_000);
        (,, uint8 pid,,) = genesis.prizeOf(u);
        assertEq(pid, 5);
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_DeckInvariants(uint256 k, uint256 salt) public {
        k = bound(k, 1, 300);
        GenesisDeckHarness h = new GenesisDeckHarness(address(token), address(nft), ecosystem, vrfCfg());
        uint256[7] memory drawn;
        uint256 extra;
        for (uint256 i; i < k; ++i) {
            uint8 id = h.draw(uint256(keccak256(abi.encode(salt, i))));
            assertLt(id, 7);
            drawn[id]++;
            extra += h.prizeExtra(id);
        }
        uint256[7] memory rem = h.remainingCounts();
        uint256 sum;
        uint256 extraFromCounts;
        for (uint256 j; j < 7; ++j) {
            assertEq(drawn[j] + rem[j], FULL[j], "assigned + remaining == initial");
            sum += rem[j];
            extraFromCounts += drawn[j] * EXTRA[j];
        }
        assertEq(sum, h.remainingTotal());
        assertEq(h.remainingTotal() + k, 300);
        assertEq(extra, extraFromCounts);
        assertLe(k * BASE + extra, BUDGET);
        if (k == 300) assertEq(k * BASE + extra, BUDGET);
    }

    function testFuzz_MintFlowSolvent(uint256 n, uint256 salt) public {
        n = bound(n, 1, 60);
        _fundAndOpen();
        _mintN(n);
        _assertSolvent();
        _fulfillN(n, salt);
        _assertSolvent();
        uint256[7] memory rem = genesis.remainingCounts();
        uint256 extra;
        for (uint256 j; j < 7; ++j) {
            extra += (FULL[j] - rem[j]) * EXTRA[j];
        }
        assertEq(genesis.extraAssigned(), extra);
        assertEq(genesis.totalAssigned(), n * BASE + extra, "base*count + extras == assigned");
        genesis.close();
        if (genesis.surplus() > 0) genesis.sweepSurplus();
        _assertSolvent();
        for (uint256 i; i < n; ++i) {
            (,,, uint256 e,) = genesis.prizeOf(gUser(i));
            if (e > 0) {
                vm.prank(gUser(i));
                genesis.claim();
            }
        }
        assertEq(token.balanceOf(address(genesis)), 0, "empty after claims + sweep");
    }
}
