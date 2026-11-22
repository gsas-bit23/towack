// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";
import {
    VRFV2PlusClient,
    IVRFCoordinatorV2Plus as OurCoordinator,
    IVRFSubscriptionV2Plus as OurSubscription
} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient as ChainlinkClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {
    IVRFCoordinatorV2Plus as ChainlinkCoordinator
} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {
    IVRFSubscriptionV2Plus as ChainlinkSubscription
} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFSubscriptionV2Plus.sol";
import {SubscriptionAPI} from "@chainlink/contracts/src/v0.8/vrf/dev/SubscriptionAPI.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev ADVERSARIAL coordinator for reentrancy tests only (the honest path uses Chainlink's official
/// VRFCoordinatorV2_5Mock). Inside `requestRandomWords` it (1) synchronously "fulfils" the id it is about
/// to return and (2) re-enters the consumer with an arbitrary call. Both must be harmless.
contract ReentrantCoordinator {
    address public target;
    bytes public reenterCall;
    uint256 public nextId = 1;
    bool public reenterSucceeded;
    bytes public reenterRevertData;

    function arm(address t, bytes calldata c) external {
        target = t;
        reenterCall = c;
    }

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata) external returns (uint256 id) {
        id = nextId++;
        if (target == address(0)) return id;
        uint256[] memory w = new uint256[](1);
        w[0] = 9_900; // would be a DrawV2 jackpot / a Genesis 1.1x if it were ever accepted
        VRFConsumerV25(target).rawFulfillRandomWords(id, w);
        (bool ok, bytes memory ret) = target.call(reenterCall);
        if (ok) reenterSucceeded = true;
        reenterRevertData = ret;
    }
}

/// @dev Contract player that re-enters on every BNB receipt (DrawV2 / Launch claims pay BNB with `call`).
contract ReentrantPlayer {
    DrawV2 public d;
    TowackLaunch public l;
    uint256 public reentries; // successful nested calls (must stay 0)
    uint256 public attempts;

    constructor(DrawV2 d_, TowackLaunch l_) {
        d = d_;
        l = l_;
    }

    function approve(IERC20 t, address s) external {
        t.approve(s, type(uint256).max);
    }

    function enter(uint256 amt) external returns (uint256 id, uint256 req) {
        return d.enter(amt);
    }

    function claimDraw() external {
        d.claim();
    }

    function mintLaunch() external payable {
        l.mint{value: msg.value}();
    }

    function claimLaunch() external {
        l.claim();
    }

    /// Re-enters only the contract that is paying (same-contract reentrancy).
    receive() external payable {
        attempts++;
        if (msg.sender == address(d)) {
            try d.claim() {
                reentries++;
            } catch {}
            try d.enter(100e18) {
                reentries++;
            } catch {}
            try d.retrySpin(1) {
                reentries++;
            } catch {}
        } else {
            try l.claim() {
                reentries++;
            } catch {}
            try l.retryPrize(address(this)) {
                reentries++;
            } catch {}
            try l.mint{value: 0}() {
                reentries++;
            } catch {}
        }
    }
}

contract OfficialVRFTest is Fixture {
    TowackGenesis genesis;
    MockAgentIdNFT nft;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant JACKPOT_WORD = 9_900; // DrawV2 10x band start

    function setUp() public override {
        super.setUp();
        nft = new MockAgentIdNFT();
        genesis = new TowackGenesis(address(token), address(nft), ecosystem, address(this), vrfCfg());
        vrf.addConsumer(subId, address(genesis));
        vm.startPrank(ecosystem);
        token.approve(address(genesis), 8_000_000e18);
        genesis.fund(8_000_000e18);
        vm.stopPrank();
        genesis.open();

        vm.startPrank(seasons);
        token.transfer(alice, 5_000_000e18);
        token.transfer(bob, 5_000_000e18);
        vm.stopPrank();
        vm.prank(alice);
        token.approve(address(drawV2), type(uint256).max);
        vm.prank(bob);
        token.approve(address(drawV2), type(uint256).max);
    }

    // ================================================================ official library / interface parity
    function test_ClientEncodingMatchesChainlink() public pure {
        assertEq(VRFV2PlusClient.EXTRA_ARGS_V1_TAG, ChainlinkClient.EXTRA_ARGS_V1_TAG);
        for (uint256 i; i < 2; ++i) {
            bool native = i == 1;
            assertEq(
                VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: native})),
                ChainlinkClient._argsToBytes(ChainlinkClient.ExtraArgsV1({nativePayment: native}))
            );
        }
        assertEq(OurCoordinator.requestRandomWords.selector, ChainlinkCoordinator.requestRandomWords.selector);
        assertEq(OurSubscription.createSubscription.selector, ChainlinkSubscription.createSubscription.selector);
        assertEq(
            OurSubscription.fundSubscriptionWithNative.selector,
            ChainlinkSubscription.fundSubscriptionWithNative.selector
        );
        assertEq(OurSubscription.addConsumer.selector, ChainlinkSubscription.addConsumer.selector);
        assertEq(OurSubscription.removeConsumer.selector, ChainlinkSubscription.removeConsumer.selector);
        assertEq(OurSubscription.getSubscription.selector, ChainlinkSubscription.getSubscription.selector);
        assertEq(OurSubscription.pendingRequestExists.selector, ChainlinkSubscription.pendingRequestExists.selector);
        assertEq(OurSubscription.cancelSubscription.selector, ChainlinkSubscription.cancelSubscription.selector);
    }

    function test_SubscriptionSetupThroughOurInterface() public {
        OurCoordinator c = OurCoordinator(address(vrf));
        uint256 s = c.createSubscription();
        c.fundSubscriptionWithNative{value: 0.04 ether}(s);
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(s, CALLBACK_GAS));
        c.addConsumer(s, address(d));
        (uint96 link, uint96 nb, uint64 reqs, address owner, address[] memory cons) = c.getSubscription(s);
        assertEq(link, 0, "no LINK needed");
        assertEq(nb, 0.04 ether);
        assertEq(reqs, 0);
        assertEq(owner, address(this));
        assertEq(cons.length, 1);
        assertEq(cons[0], address(d));
        c.removeConsumer(s, address(d));
        (,,,, cons) = c.getSubscription(s);
        assertEq(cons.length, 0);
    }

    // ================================================================ constructor validation
    function test_ConstructorRejectsNonProductionConfig() public {
        VRFConsumerV25.VRFConfig memory c = vrfCfg();
        c.keyHash = bytes32(0);
        vm.expectRevert("VRF: keyHash");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.subId = 0;
        vm.expectRevert("VRF: subId");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.requestConfirmations = 2;
        vm.expectRevert("VRF: confirmations");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.requestConfirmations = 201;
        vm.expectRevert("VRF: confirmations");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.callbackGasLimit = 99_999;
        vm.expectRevert("VRF: gas");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.callbackGasLimit = 2_500_001;
        vm.expectRevert("VRF: gas");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg();
        c.coordinator = makeAddr("eoa");
        vm.expectRevert("VRF: coordinator");
        new DrawV2(address(timelock), address(token), c);

        DrawV2 ok = new DrawV2(address(timelock), address(token), vrfCfg());
        assertEq(address(ok.vrfCoordinator()), address(vrf));
        assertEq(ok.vrfKeyHash(), KEY_HASH);
        assertEq(ok.vrfSubId(), subId);
        assertEq(ok.vrfRequestConfirmations(), 3);
        assertEq(ok.vrfCallbackGasLimit(), CALLBACK_GAS);
        assertTrue(ok.vrfNativePayment());
    }

    // ================================================================ subscription gating + billing
    function test_UnaddedConsumerCannotRequest_MintAndEnterAtomic() public {
        DrawV2 d = new DrawV2(address(timelock), address(token), vrfCfg()); // NOT added
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        uint256 bal = token.balanceOf(seasons);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionAPI.InvalidConsumer.selector, subId, address(d)));
        d.enter(1_000e18);
        vm.stopPrank();
        assertEq(token.balanceOf(seasons), bal, "entry not taken");
        assertEq(d.reservedTwak(), 0);

        // removing Genesis from the sub blocks new mints atomically (no 20k base handed out)
        vrf.removeConsumer(subId, address(genesis));
        uint256 tid = nft.registerFor(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionAPI.InvalidConsumer.selector, subId, address(genesis)));
        genesis.mint(tid);
        assertEq(genesis.mintCount(), 0);
        assertEq(token.balanceOf(alice), 5_000_000e18);
    }

    function test_FulfilmentBillsNativeSubscription() public {
        uint96 before = subNativeBalance();
        vm.recordLogs();
        (, uint256 req) = _enter(alice, 1_000e18);
        VrfReq memory r = lastVrfRequest(vm.getRecordedLogs());
        assertEq(r.extraArgs, VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true})));
        fulfillTo(address(drawV2), req, 0);
        uint96 afterBal = subNativeBalance();
        assertLt(afterBal, before, "paid in native");
        (uint96 link,, uint64 reqCount,,) = vrf.getSubscription(subId);
        assertEq(link, 0, "no LINK used");
        assertEq(reqCount, 0, "the official mock does not track reqCount");
        emit log_named_uint("mock native charge per fulfil (wei)", before - afterBal);
    }

    // ================================================================ callback gas through the official mock
    /// The official mock forwards exactly `callbackGasLimit` (250k). `fulfillTo` asserts success, so each
    /// worst case below would fail if it did not fit. The mock bill (base + gas x 1 gwei) bounds the gas.
    function test_CallbackGas_DrawV2WorstCaseCold() public {
        vm.deal(address(drawV2), 10 ether); // BNB pot -> jackpot books BNB too
        (, uint256 req) = _enter(alice, 1_000e18); // fresh player: owedTwak/owedBnb 0 -> non-zero
        vm.cool(address(drawV2));
        uint256 used = _billedGas(address(drawV2), req, JACKPOT_WORD);
        (uint256 t, uint256 b) = drawV2.spinPrize(1);
        assertEq(t, 10_000e18);
        assertGt(b, 0);
        emit log_named_uint("DrawV2 jackpot+BNB, cold (incl. mock overhead)", used);
        assertLt(used, CALLBACK_GAS);
    }

    function test_CallbackGas_GenesisWorstCaseCold() public {
        uint256 tid = nft.registerFor(alice);
        vm.prank(alice);
        genesis.mint(tid);
        (,,,,,, uint256 req) = genesis.tickets(alice);
        vm.cool(address(genesis));
        uint256 used = _billedGas(address(genesis), req, 199); // last 1.1x slot: longest walk with extra
        (,, uint8 pid,,) = genesis.prizeOf(alice);
        assertEq(pid, 5);
        emit log_named_uint("Genesis worst walk + extra, cold (incl. mock overhead)", used);
        assertLt(used, CALLBACK_GAS);
    }

    function test_CallbackGas_LaunchWorstCaseCold() public {
        mintN(1);
        vm.cool(address(launch));
        uint256 used = _billedGas(address(launch), requestOf(user(0)), 4_999); // last slot: 11-tier walk
        (,, uint8 id,,,) = launch.prizeOf(user(0));
        assertEq(id, 10);
        emit log_named_uint("Launch worst walk, cold, first draw (incl. mock overhead)", used);
        assertLt(used, CALLBACK_GAS);
    }

    /// A limit below the real cost: the coordinator reports failure, nothing is assigned, the reservation
    /// stays booked (no overdraw) and the player is not charged twice.
    function test_CallbackOutOfGas_StateSafe() public {
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(subId, 100_000));
        vrf.addConsumer(subId, address(d));
        vm.deal(address(d), 1 ether);
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        (uint256 id, uint256 req) = d.enter(1_000e18);
        vm.stopPrank();
        vm.cool(address(d));
        bool ok = fulfillToRaw(address(d), req, JACKPOT_WORD);
        assertFalse(ok, "100k is too little for a cold jackpot");
        (, uint8 st,,,,,,) = d.spins(id);
        assertEq(st, 1, "still pending");
        assertEq(d.reservedTwak(), 10_000e18, "reservation held");
        assertEq(d.outstandingTwak(), 0);
    }

    // ================================================================ coordinator-only / stale / unknown
    function test_OnlyCoordinatorCanCallback_AllConsumers() public {
        uint256[] memory w = new uint256[](1);
        address[3] memory cs = [address(launch), address(drawV2), address(genesis)];
        for (uint256 i; i < 3; ++i) {
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.OnlyCoordinator.selector, alice, address(vrf)));
            VRFConsumerV25(cs[i]).rawFulfillRandomWords(1, w);
        }
    }

    function test_RequestDeliveredToWrongConsumerIgnored() public {
        mintN(1); // Launch request id 1
        uint256 lreq = requestOf(user(0));
        (uint256 spinId, uint256 dreq) = _enter(alice, 1_000e18); // DrawV2 request id 2
        assertTrue(lreq != dreq);
        // id of the Launch request delivered to DrawV2 (and vice versa): both ignored, both succeed
        fulfillTo(address(drawV2), lreq, JACKPOT_WORD);
        (, uint8 st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 1);
        fulfillTo(address(launch), dreq, 0);
        assertEq(launch.assignedCount(), 0);
        // unknown id straight from the coordinator address: ignored
        uint256[] memory w = new uint256[](1);
        vm.prank(address(vrf));
        genesis.rawFulfillRandomWords(12345, w);
        assertEq(genesis.assignedCount(), 0);
    }

    /// Retry after delay: the coordinator later answers BOTH requests (the stale one first or last).
    /// Only the live one assigns; the sub pays for both.
    function test_RetryAfterDelay_LateStaleAnswerIgnored_AllConsumers() public {
        // DrawV2
        (uint256 spinId, uint256 d1) = _enter(alice, 1_000e18);
        // Genesis
        uint256 tid = nft.registerFor(bob);
        vm.prank(bob);
        genesis.mint(tid);
        (,,,,,, uint256 g1) = genesis.tickets(bob);
        // Launch
        mintN(1);
        uint256 l1 = requestOf(user(0));

        vm.expectRevert(DrawV2.TooEarly.selector);
        drawV2.retrySpin(spinId);
        vm.warp(block.timestamp + 1 hours);
        uint256 d2 = drawV2.retrySpin(spinId);
        genesis.retryPrize(bob);
        (,,,,,, uint256 g2) = genesis.tickets(bob);
        launch.retryPrize(user(0));
        uint256 l2 = requestOf(user(0));

        uint96 b0 = subNativeBalance();
        fulfillTo(address(drawV2), d1, JACKPOT_WORD); // stale
        fulfillTo(address(genesis), g1, 0); // stale
        fulfillTo(address(launch), l1, 0); // stale
        (, uint8 st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 1);
        assertEq(genesis.assignedCount(), 0);
        assertEq(launch.assignedCount(), 0);
        assertLt(subNativeBalance(), b0, "stale answers still cost the sub");

        fulfillTo(address(drawV2), d2, 0);
        fulfillTo(address(genesis), g2, 299);
        fulfillTo(address(launch), l2, 4_999);
        (, st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 2);
        assertEq(drawV2.owedTwak(alice), 0, "0x from the live word, not the stale jackpot");
        (,, uint8 gp,,) = genesis.prizeOf(bob);
        assertEq(gp, 6);
        (,, uint8 lp,,,) = launch.prizeOf(user(0));
        assertEq(lp, 10);
    }

    // ================================================================ reentrancy
    function test_Reentrancy_SyncFulfilAndReenterDuringRequest_DrawV2() public {
        ReentrantCoordinator evil = new ReentrantCoordinator();
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(subId, CALLBACK_GAS, address(evil)));
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        vm.stopPrank();
        vm.prank(alice);
        token.approve(address(d), type(uint256).max);

        bytes[3] memory calls = [
            abi.encodeCall(DrawV2.enter, (100e18)),
            abi.encodeCall(DrawV2.claim, ()),
            abi.encodeCall(DrawV2.retrySpin, (1))
        ];
        for (uint256 i; i < 3; ++i) {
            evil.arm(address(d), calls[i]);
            vm.prank(alice);
            (uint256 id, uint256 req) = d.enter(1_000e18);
            assertFalse(evil.reenterSucceeded(), "re-entry blocked");
            assertEq(
                evil.reenterRevertData(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            );
            (, uint8 st,,,,,,) = d.spins(id);
            assertEq(st, 1, "synchronous fulfil during the request was ignored (id not mapped yet)");
            assertEq(d.spinOfRequest(req), id);
        }
        assertEq(d.reservedTwak(), 3 * 10_000e18);
    }

    function test_Reentrancy_SyncFulfilAndReenterDuringRequest_Genesis() public {
        ReentrantCoordinator evil = new ReentrantCoordinator();
        TowackGenesis g = new TowackGenesis(
            address(token), address(nft), ecosystem, address(this), _cfgFor(subId, CALLBACK_GAS, address(evil))
        );
        vm.startPrank(ecosystem);
        token.approve(address(g), 8_000_000e18);
        g.fund(8_000_000e18);
        vm.stopPrank();
        g.open();
        uint256 t2 = nft.registerFor(alice); // alice owns two Agent IDs
        uint256 t1 = nft.registerFor(alice);
        evil.arm(address(g), abi.encodeCall(TowackGenesis.mint, (t2)));
        vm.prank(alice);
        g.mint(t1);
        assertFalse(evil.reenterSucceeded());
        assertEq(g.mintCount(), 1, "no second mint via re-entry");
        assertEq(g.assignedCount(), 0, "sync fulfil ignored");
        evil.arm(address(g), abi.encodeCall(TowackGenesis.claim, ()));
        vm.warp(block.timestamp + 1 hours);
        g.retryPrize(alice);
        assertFalse(evil.reenterSucceeded());
        assertEq(g.assignedCount(), 0);
    }

    function test_Reentrancy_ClaimBnbReceiver_DrawV2AndLaunch() public {
        ReentrantPlayer p = new ReentrantPlayer(drawV2, launch);
        // DrawV2: jackpot with BNB pays the contract player via call -> its receive() re-enters
        vm.deal(address(drawV2), 10 ether);
        vm.prank(seasons);
        token.transfer(address(p), 10_000e18);
        p.approve(IERC20(address(token)), address(drawV2));
        (, uint256 req) = p.enter(1_000e18);
        fulfillTo(address(drawV2), req, JACKPOT_WORD);
        uint256 owedT = drawV2.owedTwak(address(p));
        uint256 owedB = drawV2.owedBnb(address(p));
        assertGt(owedB, 0);
        uint256 t0 = token.balanceOf(address(p));
        p.claimDraw();
        assertEq(p.attempts(), 1);
        assertEq(p.reentries(), 0, "no nested claim / enter / launch call succeeded");
        assertEq(token.balanceOf(address(p)) - t0, owedT, "paid once");
        assertEq(address(p).balance, owedB);
        assertEq(drawV2.outstandingTwak(), 0);
        assertEq(drawV2.spinCount(), 1);

        // Launch: full refund (word 0) -> BNB to the contract minter -> re-entry attempts fail
        agentId.registerFor(address(p));
        vm.deal(address(this), 1 ether);
        p.mintLaunch{value: PRICE}();
        fulfillTo(address(launch), requestOf(address(p)), 0);
        uint256 b0 = address(p).balance;
        p.claimLaunch();
        assertEq(p.attempts(), 2);
        assertEq(p.reentries(), 0);
        assertEq(address(p).balance - b0, PRICE, "full refund paid once");
        (,,,,, bool claimed) = launch.prizeOf(address(p));
        assertTrue(claimed);
    }

    // ================================================================ pending accounting while in flight
    /// While requests are in flight on the coordinator, each pending spin keeps 10x booked, so concurrent
    /// enters shrink `availableTwak` / `maxEntry` and can never overdraw, whatever the answer order.
    function testFuzz_DrawV2PendingReservationHoldsInFlight(uint256 salt, uint8 nRaw) public {
        uint256 n = bound(nRaw, 2, 25);
        DrawV2 d = new DrawV2(address(timelock), address(token), vrfCfg());
        vrf.addConsumer(subId, address(d));
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(2_000_000e18);
        vm.stopPrank();
        vm.prank(alice);
        token.approve(address(d), type(uint256).max);

        uint256[] memory reqs = new uint256[](n);
        uint256 entered;
        uint256 count;
        for (uint256 i; i < n; ++i) {
            uint256 maxE = d.maxEntry();
            if (maxE < 100e18) break;
            uint256 amt = bound(uint256(keccak256(abi.encode(salt, i))), 100e18, maxE);
            uint256 availBefore = d.availableTwak();
            vm.prank(alice);
            (, reqs[count]) = d.enter(amt);
            ++count;
            entered += amt;
            assertEq(d.availableTwak(), availBefore + amt - 10 * amt, "10x booked while pending");
            assertEq(d.reservedTwak(), 10 * entered);
            assertGe(token.balanceOf(address(d)), d.reservedTwak() + d.outstandingTwak());
        }
        // a further over-cap entry still reverts while all are pending
        uint256 cap = d.maxEntry();
        if (cap >= 100e18) {
            vm.prank(alice);
            vm.expectRevert(abi.encodeWithSelector(DrawV2.EntryTooLarge.selector, cap + 1, cap));
            d.enter(cap + 1);
        }
        // answer in a salt-shuffled order, every answer a jackpot (worst case)
        for (uint256 k = count; k > 0; --k) {
            uint256 j = uint256(keccak256(abi.encode(salt, "o", k))) % k;
            fulfillTo(address(d), reqs[j], JACKPOT_WORD);
            reqs[j] = reqs[k - 1];
            assertGe(token.balanceOf(address(d)), d.reservedTwak() + d.outstandingTwak(), "solvent mid-flight");
        }
        assertEq(d.reservedTwak(), 0);
        assertEq(d.outstandingTwak(), 10 * entered);
        vm.prank(alice);
        d.claim();
        assertEq(d.outstandingTwak(), 0);
    }

    /// Genesis: pending draws stay covered after close (worst-case 5x each, capped by the deck), the owner
    /// cannot sweep them, and late VRF answers + claims still settle.
    function test_GenesisPendingDeckAccountingAcrossClose() public {
        address[3] memory us = [alice, bob, makeAddr("carol")];
        for (uint256 i; i < 3; ++i) {
            uint256 tid = nft.registerFor(us[i]);
            vm.prank(us[i]);
            genesis.mint(tid);
        }
        genesis.close();
        assertEq(genesis.committed(), 3 * genesis.MAX_EXTRA(), "3 pending x 80k worst case");
        genesis.sweepSurplus();
        assertEq(token.balanceOf(address(genesis)), 3 * 80_000e18);
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();

        vm.warp(block.timestamp + 1 hours);
        genesis.retryPrize(bob); // retry after close is still allowed
        for (uint256 i; i < 3; ++i) {
            (,,,,,, uint256 req) = genesis.tickets(us[i]);
            fulfillTo(address(genesis), req, 0); // all 5x (5 such slots exist)
            assertGe(token.balanceOf(address(genesis)), genesis.committed());
        }
        assertEq(genesis.assignedCount(), 3);
        for (uint256 i; i < 3; ++i) {
            vm.prank(us[i]);
            genesis.claim();
        }
        assertEq(token.balanceOf(address(genesis)), 0);
    }

    /// Launch: pending mints block the listing until the coordinator answers (or a retry is answered).
    function test_LaunchPendingDeckAccounting() public {
        mintN(3);
        assertEq(launch.pendingCount(), 3);
        assertEq(launch.remainingTotal(), 5_000, "deck untouched while in flight");
        fulfillTo(address(launch), requestOf(user(0)), 0);
        assertEq(launch.remainingTotal(), 4_999);
        close();
        vm.expectRevert(abi.encodeWithSelector(TowackLaunch.PrizesPending.selector, 2));
        launch.finalizeListing();
        uint256 stale = requestOf(user(1));
        vm.warp(block.timestamp + 1 hours);
        launch.retryPrize(user(1));
        fulfillTo(address(launch), stale, 0);
        assertEq(launch.pendingCount(), 2, "stale answer does not count");
        fulfillTo(address(launch), requestOf(user(1)), 1);
        fulfillTo(address(launch), requestOf(user(2)), 2);
        assertEq(launch.pendingCount(), 0);
        assertEq(launch.remainingTotal(), 4_997);
        launch.finalizeListing();
    }

    // ================================================================ helpers
    function _enter(address who, uint256 amt) internal returns (uint256 spinId, uint256 req) {
        vm.prank(who);
        (spinId, req) = drawV2.enter(amt);
    }

    function _cfgFor(uint256 s, uint32 gasLimit) internal view returns (VRFConsumerV25.VRFConfig memory c) {
        c = vrfCfg();
        c.subId = s;
        c.callbackGasLimit = gasLimit;
    }

    function _cfgFor(uint256 s, uint32 gasLimit, address coord)
        internal
        view
        returns (VRFConsumerV25.VRFConfig memory c)
    {
        c = _cfgFor(s, gasLimit);
        c.coordinator = coord;
    }

    /// Fulfils through the official mock and returns the gas it billed (callback + the mock's own overhead).
    function _billedGas(address consumer, uint256 req, uint256 word) internal returns (uint256) {
        uint96 b0 = subNativeBalance();
        fulfillTo(consumer, req, word);
        uint256 paid = b0 - subNativeBalance();
        return (paid - MOCK_BASE_FEE) / MOCK_GAS_PRICE;
    }
}
