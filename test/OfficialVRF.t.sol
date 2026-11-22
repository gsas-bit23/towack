// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {VRFWrapperMock} from "./VRFWrapperMock.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";
import {VRFV2PlusClient} from "../src/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient as ChainlinkClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {VRFV2PlusWrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapperConsumerBase.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev ADVERSARIAL wrapper for reentrancy tests only (the honest path uses VRFWrapperMock). Inside
/// `requestRandomWordsInNative` it (1) synchronously "fulfils" the id it is about to return and (2) re-enters the
/// consumer with an arbitrary call. Both must be harmless. Price = flat 0.001 BNB.
contract ReentrantWrapper {
    address public target;
    bytes public reenterCall;
    uint256 public nextId = 1;
    bool public reenterSucceeded;
    bytes public reenterRevertData;

    function link() external pure returns (address) {
        return address(0x1111);
    }

    function calculateRequestPriceNative(uint32, uint32) external pure returns (uint256) {
        return 0.001 ether;
    }

    function estimateRequestPriceNative(uint32, uint32, uint256) external pure returns (uint256) {
        return 0.001 ether;
    }

    function arm(address t, bytes calldata c) external {
        target = t;
        reenterCall = c;
    }

    function requestRandomWordsInNative(uint32, uint16, uint32, bytes calldata) external payable returns (uint256 id) {
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

/// @dev Wrapper that is down (Chainlink `disable()`d it, or it reverts for any reason): requests must revert
/// atomically with the mint / entry.
contract DisabledWrapper {
    function link() external pure returns (address) {
        return address(0x1111);
    }

    function calculateRequestPriceNative(uint32, uint32) external pure returns (uint256) {
        return 0.001 ether;
    }

    function estimateRequestPriceNative(uint32, uint32, uint256) external pure returns (uint256) {
        return 0.001 ether;
    }

    function requestRandomWordsInNative(uint32, uint16, uint32, bytes calldata) external payable returns (uint256) {
        revert("wrapper is disabled");
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

    function enter(uint256 amt) external payable returns (uint256 id, uint256 req) {
        return d.enter{value: msg.value}(amt);
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

    function claimReferralLaunch() external {
        l.claimReferral();
    }

    /// Re-enters only the contract that is paying (same-contract reentrancy).
    receive() external payable {
        attempts++;
        if (msg.sender == address(d)) {
            try d.claim() {
                reentries++;
            } catch {}
            try d.enter{value: 0}(100e18) {
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
            try l.claimReferral() {
                reentries++;
            } catch {}
        }
    }
}

/// @dev A caller that cannot receive BNB (no receive / fallback): any refund to it must revert the request.
contract NoReceive {
    function enter(DrawV2 d, IERC20 t, uint256 amt) external payable {
        t.approve(address(d), amt);
        d.enter{value: msg.value}(amt);
    }
}

contract OfficialVRFTest is Fixture {
    TowackGenesis genesis;
    MockAgentIdNFT nft;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 genesisFee;

    uint256 constant JACKPOT_WORD = 9_900; // DrawV2 10x band start

    function setUp() public override {
        super.setUp();
        nft = new MockAgentIdNFT();
        genesis = new TowackGenesis(
            address(token), address(nft), ecosystem, address(this), vrfCfg(GENESIS_CALLBACK_GAS)
        );
        genesisFee = genesis.vrfFeeAt(TEST_GAS_PRICE);
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
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(seasons, 100 ether);
        vm.deal(makeAddr("carol"), 100 ether);
    }

    // ================================================================ official library / interface parity
    function test_ClientEncodingAndWrapperInterfaceMatchChainlink() public pure {
        assertEq(VRFV2PlusClient.EXTRA_ARGS_V1_TAG, ChainlinkClient.EXTRA_ARGS_V1_TAG);
        for (uint256 i; i < 2; ++i) {
            bool native = i == 1;
            assertEq(
                VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: native})),
                ChainlinkClient._argsToBytes(ChainlinkClient.ExtraArgsV1({nativePayment: native}))
            );
        }
        // the mock exposes the official wrapper's selectors
        assertEq(VRFWrapperMock.calculateRequestPriceNative.selector, IVRFV2PlusWrapper.calculateRequestPriceNative.selector);
        assertEq(VRFWrapperMock.estimateRequestPriceNative.selector, IVRFV2PlusWrapper.estimateRequestPriceNative.selector);
        assertEq(VRFWrapperMock.requestRandomWordsInNative.selector, IVRFV2PlusWrapper.requestRandomWordsInNative.selector);
        assertEq(bytes4(keccak256("lastRequestId()")), IVRFV2PlusWrapper.lastRequestId.selector); // mock getter
        assertEq(bytes4(keccak256("link()")), IVRFV2PlusWrapper.link.selector); // mock getter
        // our callback entry point is the one the official wrapper calls
        assertEq(
            VRFConsumerV25.rawFulfillRandomWords.selector, VRFV2PlusWrapperConsumerBase.rawFulfillRandomWords.selector
        );
    }

    // ================================================================ constructor validation
    function test_ConstructorRejectsNonProductionConfig() public {
        VRFConsumerV25.VRFConfig memory c = vrfCfg(DRAW_CALLBACK_GAS);
        c.requestConfirmations = 2;
        vm.expectRevert("VRF: confirmations");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg(DRAW_CALLBACK_GAS);
        c.requestConfirmations = 201;
        vm.expectRevert("VRF: confirmations");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg(DRAW_CALLBACK_GAS);
        c.callbackGasLimit = 49_999;
        vm.expectRevert("VRF: gas");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg(DRAW_CALLBACK_GAS);
        c.callbackGasLimit = 2_500_001;
        vm.expectRevert("VRF: gas");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg(DRAW_CALLBACK_GAS);
        c.wrapper = makeAddr("eoa");
        vm.expectRevert("VRF: wrapper");
        new DrawV2(address(timelock), address(token), c);

        c = vrfCfg(DRAW_CALLBACK_GAS);
        c.wrapper = address(0);
        vm.expectRevert("VRF: wrapper");
        new DrawV2(address(timelock), address(token), c);

        DrawV2 ok = new DrawV2(address(timelock), address(token), vrfCfg(DRAW_CALLBACK_GAS));
        assertEq(address(ok.vrfWrapper()), address(vrf));
        assertEq(ok.vrfRequestConfirmations(), 3);
        assertEq(ok.vrfCallbackGasLimit(), DRAW_CALLBACK_GAS);
        assertEq(address(launch.vrfWrapper()), address(vrf));
        assertEq(launch.vrfCallbackGasLimit(), LAUNCH_CALLBACK_GAS);
        assertEq(address(genesis.vrfWrapper()), address(vrf));
        assertEq(genesis.vrfCallbackGasLimit(), GENESIS_CALLBACK_GAS);
    }

    // ================================================================ fee quote
    /// vrfFeeAt(gp) = wrapper.estimateRequestPriceNative(limit, 1, gp) * 1.10. Mock = official formula with the
    /// live BSC wrapper config (13,400 + (limit + 99,500 + 435) * 1.6, times gp; flat fee 0).
    function test_Fee_QuoteIsWrapperEstimatePlusBuffer() public {
        uint256[4] memory gps = [uint256(0.05 gwei), 0.1 gwei, 1 gwei, 5 gwei];
        for (uint256 i; i < 4; ++i) {
            uint256 g = gps[i];
            assertEq(launch.vrfFeeAt(g), wrapperPriceAt(LAUNCH_CALLBACK_GAS, g) * 11_000 / 10_000);
            assertEq(genesis.vrfFeeAt(g), wrapperPriceAt(GENESIS_CALLBACK_GAS, g) * 11_000 / 10_000);
            assertEq(drawV2.vrfFeeAt(g), wrapperPriceAt(DRAW_CALLBACK_GAS, g) * 11_000 / 10_000);
            assertEq(drawV2.vrfFeeAt(g), vrf.estimateRequestPriceNative(DRAW_CALLBACK_GAS, 1, g) * 11_000 / 10_000);
        }
        assertEq(drawV2.vrfFeeAt(0), 0, "no flat fee on BSC: an eth_call quote at gas price 0 is 0 (UI must pass a gas price)");
        assertEq(drawV2.vrfFee(), drawV2.vrfFeeAt(tx.gasprice));
        assertEq(launchFee, launch.vrfFeeAt(TEST_GAS_PRICE));
        // 1 gwei, Launch 165k: 13,400 + 264,935 * 1.6 = 437,296 gwei-units -> 0.000437296 BNB (matches the live
        // testnet wrapper's estimateRequestPriceNative(165000, 1, 1 gwei) read 2026-11-22).
        assertEq(wrapperPrice(LAUNCH_CALLBACK_GAS), 437_296 gwei);
        // a flat fee on the wrapper flows straight into the quote
        vrf.setConfig(13_400, 99_500, 435, 60, 5_000);
        assertEq(drawV2.vrfFeeAt(1 gwei), (wrapperPriceAt(DRAW_CALLBACK_GAS, 1 gwei) + 5_000 * 1e12) * 11_000 / 10_000);
        emit log_named_uint("Launch fee quote @1 gwei (wei)", launchFee);
        emit log_named_uint("DrawV2 fee quote @1 gwei (wei)", drawFee);
        emit log_named_uint("Genesis fee quote @1 gwei (wei)", genesisFee);
    }

    // ================================================================ user-paid VRF fee
    function test_Fee_TooLow_RevertsAtomically_AllConsumers() public {
        uint256 lp = wrapperPrice(LAUNCH_CALLBACK_GAS);
        uint256 gp = wrapperPrice(GENESIS_CALLBACK_GAS);
        uint256 dp = wrapperPrice(DRAW_CALLBACK_GAS);
        // Launch: 0.1 BNB + exact price - 1
        address u = newAgent("lowfee");
        vm.deal(u, 1 ether);
        uint256 w0 = address(vrf).balance;
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, lp - 1, lp));
        launch.mint{value: PRICE + lp - 1}();
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, 0, lp));
        launch.mint{value: PRICE}();
        assertEq(u.balance, 1 ether, "Launch BNB not taken");
        assertEq(address(launch).balance, 0);
        assertEq(token.balanceOf(u), 0, "no TWAK");
        assertEq(launch.mintCount(), 0);
        assertFalse(launch.hasMinted(u));

        // Genesis: price - 1 (no mint price)
        uint256 tid = nft.registerFor(u);
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, gp - 1, gp));
        genesis.mint{value: gp - 1}(tid);
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, 0, gp));
        genesis.mint(tid);
        assertEq(genesis.mintCount(), 0);
        assertFalse(genesis.tokenIdUsed(tid));
        assertEq(token.balanceOf(u), 0, "no 20k base");

        // DrawV2: price - 1
        uint256 a0 = token.balanceOf(alice);
        uint256 ab = alice.balance;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, dp - 1, dp));
        drawV2.enter{value: dp - 1}(1_000e18);
        assertEq(token.balanceOf(alice), a0, "no TWAK moved");
        assertEq(alice.balance, ab);
        assertEq(drawV2.spinCount(), 0, "no spin");
        assertEq(drawV2.reservedTwak(), 0);
        assertEq(drawV2.totalEntered(), 0);
        assertEq(address(vrf).balance, w0, "wrapper untouched");
        assertEq(vrf.requestCount(), 0);
    }

    /// The wrapper gets EXACTLY its price (not the buffered quote, not the mint price); excess comes back in the
    /// same tx; only 0.1 BNB stays in Launch.
    function test_Fee_ExcessRefunded_WrapperGetsExactPrice_Launch() public {
        address u = newAgent("over");
        vm.deal(u, 1 ether);
        uint256 price = wrapperPrice(LAUNCH_CALLBACK_GAS);
        assertGt(launchFee, price, "quote carries a buffer");
        uint256 w0 = address(vrf).balance;
        vm.expectEmit(true, true, false, true, address(launch));
        emit VRFConsumerV25.VrfFeePaid(u, 1, price);
        vm.prank(u);
        launch.mint{value: PRICE + launchFee + 0.37 ether}();
        assertEq(u.balance, 1 ether - PRICE - price, "refund = msg.value - MINT_PRICE - exact price");
        assertEq(address(launch).balance, PRICE, "mint price stays, nothing else");
        assertEq(address(vrf).balance - w0, price, "wrapper got exactly its price, not the buffer");
        assertEq(vrf.totalPaid(), price);
        fulfillTo(address(launch), requestOf(u), 0);
        assertEq(launch.assignedCount(), 1);
    }

    function test_Fee_ExcessRefunded_GenesisAndDrawV2_FeeNotInBnbPot() public {
        uint256 w0 = address(vrf).balance;
        uint256 gp = wrapperPrice(GENESIS_CALLBACK_GAS);
        uint256 dp = wrapperPrice(DRAW_CALLBACK_GAS);
        uint256 tid = nft.registerFor(alice);
        uint256 ab = alice.balance;
        vm.prank(alice);
        genesis.mint{value: 1 ether}(tid);
        assertEq(ab - alice.balance, gp);
        assertEq(address(genesis).balance, 0);

        vm.deal(address(drawV2), 10 ether); // BNB pot
        uint256 avail0 = drawV2.availableBnb();
        uint256 amt = drawV2.maxEntry(); // max entry => the full 2% cap
        ab = alice.balance;
        vm.prank(alice);
        (uint256 spinId,) = drawV2.enter{value: 5 ether}(amt);
        (,,,,,, uint256 bnbCap,) = drawV2.spins(spinId);
        assertEq(bnbCap, 0.2 ether, "2% of the 10 BNB pot; msg.value is not pot money");
        assertEq(address(drawV2).balance, 10 ether, "price forwarded, excess refunded: pot unchanged");
        assertEq(drawV2.availableBnb(), avail0 - bnbCap, "only the reservation moved");
        assertEq(ab - alice.balance, dp);
        assertEq(address(vrf).balance - w0, gp + dp);
    }

    function testFuzz_Fee_RefundExact(uint96 extra) public {
        uint256 x = bound(extra, 0, 50 ether);
        uint256 price = wrapperPrice(DRAW_CALLBACK_GAS);
        uint256 ab = alice.balance;
        uint256 w0 = address(vrf).balance;
        vm.prank(alice);
        drawV2.enter{value: price + x}(1_000e18);
        assertEq(ab - alice.balance, price);
        assertEq(address(vrf).balance - w0, price);
        assertEq(address(drawV2).balance, 0);
    }

    /// Whatever the tx gas price, the charge is the wrapper's price at THAT gas price and the quote at the same
    /// gas price always covers it (refund = the 10% buffer).
    function testFuzz_Fee_ChargedAtTxGasPrice(uint256 gpRaw) public {
        uint256 g = bound(gpRaw, 0.01 gwei, 1_000 gwei);
        vm.txGasPrice(g);
        uint256 quote = drawV2.vrfFeeAt(g);
        uint256 price = wrapperPriceAt(DRAW_CALLBACK_GAS, g);
        uint256 ab = alice.balance;
        vm.prank(alice);
        drawV2.enter{value: quote}(1_000e18);
        assertEq(ab - alice.balance, price);
        assertEq(address(vrf).balance, price);
    }

    /// Gas spike between quote and inclusion. A fee quoted at 1 gwei is NOT enough for a request mined at
    /// 5 gwei (the wrapper prices at tx.gasprice): it reverts atomically. Quoting at the real gas price works.
    /// The frontend (`useVrfFee`) quotes at gasPrice x 1.25 and sends the quote + 10%; with the contract's own
    /// 10% buffer that tolerates a ~1.5x move. Both buffers are refunded when unused.
    function test_Fee_GasSpike_LowQuoteReverts_HigherQuoteSucceeds() public {
        uint256 q1 = drawV2.vrfFeeAt(1 gwei);
        vm.txGasPrice(5 gwei);
        uint256 p5 = wrapperPriceAt(DRAW_CALLBACK_GAS, 5 gwei);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, q1, p5));
        drawV2.enter{value: q1}(1_000e18);
        uint256 lq1 = launch.vrfFeeAt(1 gwei);
        uint256 lp5 = wrapperPriceAt(LAUNCH_CALLBACK_GAS, 5 gwei);
        address u = newAgent("spike");
        vm.deal(u, 1 ether);
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, lq1, lp5));
        launch.mint{value: PRICE + lq1}();
        uint256 tid = nft.registerFor(u);
        uint256 gq1 = genesis.vrfFeeAt(1 gwei);
        uint256 gp5 = wrapperPriceAt(GENESIS_CALLBACK_GAS, 5 gwei);
        vm.prank(u);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, gq1, gp5));
        genesis.mint{value: gq1}(tid);
        assertEq(vrf.requestCount(), 0);

        // quoted at the real 5 gwei: succeeds, charged exactly p5, buffer refunded
        uint256 q5 = drawV2.vrfFeeAt(5 gwei);
        uint256 ab = alice.balance;
        vm.prank(alice);
        drawV2.enter{value: q5}(1_000e18);
        assertEq(ab - alice.balance, p5);
        assertEq(address(vrf).balance, p5);

        // frontend recipe: estimate 1 gwei -> quote vrfFeeAt(1.25 gwei), send +10%; tx lands at 1.5 gwei -> ok
        uint256 sent = drawV2.vrfFeeAt(1.25 gwei) * 110 / 100;
        vm.txGasPrice(1.5 gwei);
        ab = alice.balance;
        vm.prank(alice);
        drawV2.enter{value: sent}(1_000e18);
        assertEq(ab - alice.balance, wrapperPriceAt(DRAW_CALLBACK_GAS, 1.5 gwei), "charged at 1.5 gwei, rest refunded");
    }

    function test_Fee_RetryPathsCollectFee() public {
        (uint256 spinId,) = _enter(alice, 1_000e18);
        uint256 tid = nft.registerFor(bob);
        vm.prank(bob);
        genesis.mint{value: genesisFee}(tid);
        mintN(1);
        vm.warp(block.timestamp + 1 hours);
        uint256 dp = wrapperPrice(DRAW_CALLBACK_GAS);
        uint256 gp = wrapperPrice(GENESIS_CALLBACK_GAS);
        uint256 lp = wrapperPrice(LAUNCH_CALLBACK_GAS);

        address r = makeAddr("retrier");
        vm.deal(r, 1 ether);
        vm.startPrank(r);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, 0, dp));
        drawV2.retrySpin(spinId);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, gp - 1, gp));
        genesis.retryPrize{value: gp - 1}(bob);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.VrfFeeTooLow.selector, lp - 1, lp));
        launch.retryPrize{value: lp - 1}(user(0));

        uint256 w0 = address(vrf).balance;
        drawV2.retrySpin{value: drawFee + 0.1 ether}(spinId);
        genesis.retryPrize{value: genesisFee + 0.1 ether}(bob);
        launch.retryPrize{value: launchFee + 0.1 ether}(user(0));
        vm.stopPrank();
        assertEq(address(vrf).balance - w0, dp + gp + lp, "each retry pays the wrapper its exact price");
        assertEq(r.balance, 1 ether - dp - gp - lp, "retrier refunded the excess");
        assertEq(address(launch).balance, PRICE, "retry fee never touches launch accounting");
    }

    function test_Fee_RefundToNonReceiverReverts() public {
        NoReceive nr = new NoReceive();
        vm.prank(seasons);
        token.transfer(address(nr), 10_000e18);
        vm.deal(address(this), 1 ether);
        uint256 price = wrapperPrice(DRAW_CALLBACK_GAS);
        vm.expectRevert(VRFConsumerV25.RefundFailed.selector);
        nr.enter{value: price + 1}(drawV2, IERC20(address(token)), 1_000e18);
        assertEq(drawV2.spinCount(), 0);
        nr.enter{value: price}(drawV2, IERC20(address(token)), 1_000e18); // exact price: no refund call
        assertEq(drawV2.spinCount(), 1);
    }

    /// The request carries ExtraArgsV1{nativePayment: true} (the mock rejects anything else, like the real
    /// wrapper's checkPaymentMode), the consumer's own confirmations and callback limit, one word.
    function test_RequestShape() public {
        vm.recordLogs();
        (, uint256 req) = _enter(alice, 1_000e18);
        VrfReq memory r = lastVrfRequest(vm.getRecordedLogs());
        assertEq(r.requestId, req);
        assertEq(vrf.lastRequestId(), 0, "native path does not set lastRequestId (official behaviour)");
        assertEq(r.sender, address(drawV2));
        assertEq(r.callbackGasLimit, DRAW_CALLBACK_GAS);
        assertEq(r.confirmations, 3);
        assertEq(r.paid, wrapperPrice(DRAW_CALLBACK_GAS));
        (,,, uint32 numWords,) = vrf.callbacks(req);
        assertEq(numWords, 1);
    }

    /// A wrapper that reverts (e.g. disabled by Chainlink) makes mint / enter revert atomically.
    function test_WrapperDown_RequestsRevertAtomically() public {
        DisabledWrapper w = new DisabledWrapper();
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(DRAW_CALLBACK_GAS, address(w)));
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        uint256 bal = token.balanceOf(seasons);
        vm.expectRevert("wrapper is disabled");
        d.enter{value: 1 ether}(1_000e18);
        vm.stopPrank();
        assertEq(token.balanceOf(seasons), bal, "entry not taken");
        assertEq(d.reservedTwak(), 0);
        assertEq(d.spinCount(), 0);
    }

    // ================================================================ callback gas through the wrapper mock
    /// The wrapper forwards exactly `callbackGasLimit` (`_callWithExactGas`). `fulfillTo` asserts success, so each
    /// worst case below would fail if it did not fit. `lastCallbackGasUsed` = gas consumed by the CALL into the
    /// consumer (callee execution + the CALL's cold-account / memory costs): an upper bound on callback use.
    function test_CallbackGas_DrawV2WorstCaseCold() public {
        vm.deal(address(drawV2), 10 ether); // BNB pot -> jackpot books BNB too
        (, uint256 req) = _enter(alice, 1_000e18); // fresh player: owedTwak/owedBnb 0 -> non-zero
        vm.cool(address(drawV2));
        uint256 used = _callbackGas(address(drawV2), req, JACKPOT_WORD);
        (uint256 t, uint256 b) = drawV2.spinPrize(1);
        assertEq(t, 10_000e18);
        assertGt(b, 0);
        emit log_named_uint("DrawV2 jackpot+BNB, cold (through wrapper)", used);
        assertLe(used * 120 / 100, DRAW_CALLBACK_GAS, ">= 20% headroom at the tight limit");
    }

    function test_CallbackGas_GenesisWorstCaseCold() public {
        uint256 tid = nft.registerFor(alice);
        vm.prank(alice);
        genesis.mint{value: genesisFee}(tid);
        (,,,,,, uint256 req) = genesis.tickets(alice);
        vm.cool(address(genesis));
        uint256 used = _callbackGas(address(genesis), req, 199); // last 1.1x slot: longest walk with extra
        (,, uint8 pid,,) = genesis.prizeOf(alice);
        assertEq(pid, 5);
        emit log_named_uint("Genesis worst walk + extra, cold (through wrapper)", used);
        assertLe(used * 120 / 100, GENESIS_CALLBACK_GAS, ">= 20% headroom at the tight limit");
    }

    /// Launch worst case = the FIRST bonus draw on the longest walk (id 9, 1.1x: 10-tier walk + bonusAssigned /
    /// bonusOutstanding 0 -> non-zero), not the no-win last slot (11-tier walk, no accumulator writes).
    function test_CallbackGas_LaunchWorstCaseCold() public {
        mintN(1);
        uint256 req = requestOf(user(0));
        uint256 snap = vm.snapshotState();
        uint256[3] memory words = [uint256(4_519), 4_999, 3_499]; // last 1.1x slot, last no-win slot, last 25% refund
        uint8[3] memory ids = [uint8(9), 10, 3];
        uint256 worst;
        uint256 worstId;
        for (uint256 i; i < 3; ++i) {
            vm.revertToState(snap);
            vm.cool(address(launch));
            uint256 used = _callbackGas(address(launch), req, words[i]);
            (,, uint8 id,,,) = launch.prizeOf(user(0));
            assertEq(id, ids[i]);
            if (used > worst) (worst, worstId) = (used, id);
            emit log_named_uint("Launch first draw, cold (through wrapper), prize id", ids[i]);
            emit log_named_uint("  gas", used);
        }
        assertEq(worstId, 9, "first 1.1x bonus is the worst case");
        assertLe(worst * 120 / 100, LAUNCH_CALLBACK_GAS, ">= 20% headroom at the tight limit");
    }

    /// A limit below the real cost: the wrapper reports failure (WrapperFulfillmentFailed, no revert), nothing is
    /// assigned, the reservation stays booked (no overdraw); a retry recovers.
    function test_CallbackOutOfGas_StateSafe() public {
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(50_000, address(vrf)));
        vm.deal(address(d), 1 ether);
        vm.startPrank(seasons);
        token.approve(address(d), type(uint256).max);
        d.seed(1_000_000e18);
        (uint256 id, uint256 req) = d.enter{value: d.vrfFeeAt(TEST_GAS_PRICE)}(1_000e18);
        vm.stopPrank();
        vm.cool(address(d));
        vm.expectEmit(true, true, false, false, address(vrf));
        emit VRFWrapperMock.WrapperFulfillmentFailed(req, address(d));
        bool ok = vrf.fulfill(req, JACKPOT_WORD);
        assertFalse(ok, "50k is too little for a cold jackpot");
        (, uint8 st,,,,,,) = d.spins(id);
        assertEq(st, 1, "still pending");
        assertEq(d.reservedTwak(), 10_000e18, "reservation held");
        assertEq(d.outstandingTwak(), 0);
    }

    // ================================================================ wrapper-only / stale / unknown
    function test_OnlyWrapperCanCallback_AllConsumers() public {
        uint256[] memory w = new uint256[](1);
        address[3] memory cs = [address(launch), address(drawV2), address(genesis)];
        address[2] memory callers = [alice, 0xDA3b641D438362C440Ac5458c57e00a712b66700]; // incl. the coordinator
        for (uint256 i; i < 3; ++i) {
            for (uint256 k; k < 2; ++k) {
                vm.prank(callers[k]);
                vm.expectRevert(
                    abi.encodeWithSelector(VRFConsumerV25.OnlyVRFWrapperCanFulfill.selector, callers[k], address(vrf))
                );
                VRFConsumerV25(cs[i]).rawFulfillRandomWords(1, w);
            }
        }
        // a real pending request answered by a random caller: reverts, request stays pending, wrapper can still answer
        (uint256 spinId, uint256 req) = _enter(alice, 1_000e18);
        w[0] = JACKPOT_WORD;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VRFConsumerV25.OnlyVRFWrapperCanFulfill.selector, bob, address(vrf)));
        drawV2.rawFulfillRandomWords(req, w);
        (, uint8 st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 1);
        fulfillTo(address(drawV2), req, 0);
        (, st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 2);
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
        // unknown id straight from the wrapper address: ignored
        uint256[] memory w = new uint256[](1);
        vm.prank(address(vrf));
        genesis.rawFulfillRandomWords(12345, w);
        assertEq(genesis.assignedCount(), 0);
        // empty words from the wrapper: ignored
        vm.prank(address(vrf));
        drawV2.rawFulfillRandomWords(dreq, new uint256[](0));
        (, st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 1);
    }

    /// Retry after delay: the wrapper later answers BOTH requests (the stale one first or last).
    /// Only the live one assigns; each request was prepaid to the wrapper.
    function test_RetryAfterDelay_LateStaleAnswerIgnored_AllConsumers() public {
        // DrawV2
        (uint256 spinId, uint256 d1) = _enter(alice, 1_000e18);
        // Genesis
        uint256 tid = nft.registerFor(bob);
        vm.prank(bob);
        genesis.mint{value: genesisFee}(tid);
        (,,,,,, uint256 g1) = genesis.tickets(bob);
        // Launch
        mintN(1);
        uint256 l1 = requestOf(user(0));

        vm.expectRevert(DrawV2.TooEarly.selector);
        drawV2.retrySpin{value: drawFee}(spinId);
        vm.warp(block.timestamp + 1 hours);
        uint256 d2 = drawV2.retrySpin{value: drawFee}(spinId);
        genesis.retryPrize{value: genesisFee}(bob);
        (,,,,,, uint256 g2) = genesis.tickets(bob);
        launch.retryPrize{value: launchFee}(user(0));
        uint256 l2 = requestOf(user(0));

        uint256 paid0 = vrf.totalPaid();
        fulfillTo(address(drawV2), d1, JACKPOT_WORD); // stale
        fulfillTo(address(genesis), g1, 0); // stale
        fulfillTo(address(launch), l1, 0); // stale
        (, uint8 st,,,,,,) = drawV2.spins(spinId);
        assertEq(st, 1);
        assertEq(genesis.assignedCount(), 0);
        assertEq(launch.assignedCount(), 0);
        assertEq(vrf.totalPaid(), paid0, "answers cost nothing extra: every request was prepaid");

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
        ReentrantWrapper evil = new ReentrantWrapper();
        DrawV2 d = new DrawV2(address(timelock), address(token), _cfgFor(DRAW_CALLBACK_GAS, address(evil)));
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
            uint256 f = d.vrfFeeAt(TEST_GAS_PRICE);
            vm.prank(alice);
            (uint256 id, uint256 req) = d.enter{value: f}(1_000e18);
            assertFalse(evil.reenterSucceeded(), "re-entry blocked");
            assertEq(
                evil.reenterRevertData(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            );
            (, uint8 st,,,,,,) = d.spins(id);
            assertEq(st, 1, "synchronous fulfil during the request was ignored (id not mapped yet)");
            assertEq(d.spinOfRequest(req), id);
        }
        assertEq(d.reservedTwak(), 3 * 10_000e18);
        assertEq(address(evil).balance, 3 * 0.001 ether, "exact price each time");
    }

    function test_Reentrancy_SyncFulfilAndReenterDuringRequest_Genesis() public {
        ReentrantWrapper evil = new ReentrantWrapper();
        TowackGenesis g = new TowackGenesis(
            address(token), address(nft), ecosystem, address(this), _cfgFor(DRAW_CALLBACK_GAS, address(evil))
        );
        vm.startPrank(ecosystem);
        token.approve(address(g), 8_000_000e18);
        g.fund(8_000_000e18);
        vm.stopPrank();
        g.open();
        uint256 t2 = nft.registerFor(alice); // alice owns two Agent IDs
        uint256 t1 = nft.registerFor(alice);
        evil.arm(address(g), abi.encodeCall(TowackGenesis.mint, (t2)));
        uint256 gf = g.vrfFeeAt(TEST_GAS_PRICE);
        vm.prank(alice);
        g.mint{value: gf}(t1);
        assertFalse(evil.reenterSucceeded());
        assertEq(g.mintCount(), 1, "no second mint via re-entry");
        assertEq(g.assignedCount(), 0, "sync fulfil ignored");
        evil.arm(address(g), abi.encodeCall(TowackGenesis.claim, ()));
        vm.warp(block.timestamp + 1 hours);
        g.retryPrize{value: gf}(alice);
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
        (, uint256 req) = p.enter{value: drawFee}(1_000e18); // the fee-buffer refund already hits receive()
        assertEq(p.attempts(), 1);
        assertEq(p.reentries(), 0, "no re-entry from the refund");
        fulfillTo(address(drawV2), req, JACKPOT_WORD);
        uint256 owedT = drawV2.owedTwak(address(p));
        uint256 owedB = drawV2.owedBnb(address(p));
        assertGt(owedB, 0);
        uint256 t0 = token.balanceOf(address(p));
        uint256 pb0 = address(p).balance; // = the refunded fee buffer
        assertEq(pb0, drawFee - wrapperPrice(DRAW_CALLBACK_GAS));
        p.claimDraw();
        assertEq(p.attempts(), 2);
        assertEq(p.reentries(), 0, "no nested claim / enter / launch call succeeded");
        assertEq(token.balanceOf(address(p)) - t0, owedT, "paid once");
        assertEq(address(p).balance - pb0, owedB);
        assertEq(drawV2.outstandingTwak(), 0);
        assertEq(drawV2.spinCount(), 1);

        // Launch: full refund (word 0) -> BNB to the contract minter -> re-entry attempts fail
        agentId.registerFor(address(p));
        vm.deal(address(this), 1 ether);
        p.mintLaunch{value: PRICE + launchFee}();
        fulfillTo(address(launch), requestOf(address(p)), 0);
        uint256 b0 = address(p).balance;
        assertEq(p.attempts(), 3, "mint refund");
        p.claimLaunch();
        assertEq(p.attempts(), 4);
        assertEq(p.reentries(), 0);
        assertEq(address(p).balance - b0, launch.prizeBnb(0), "full refund paid once");
        (,,,,, bool claimed) = launch.prizeOf(address(p));
        assertTrue(claimed);

        // Launch referral: p is a referrer; claimReferral pays it via call -> nested claimReferral fails
        address friend = makeAddr("friend");
        agentId.registerFor(friend);
        vm.deal(friend, PRICE + launchFee);
        vm.prank(friend);
        launch.mint{value: PRICE + launchFee}(address(p));
        uint256 b1 = address(p).balance;
        p.claimReferralLaunch();
        assertEq(p.attempts(), 5);
        assertEq(p.reentries(), 0, "no nested claimReferral");
        assertEq(address(p).balance - b1, launch.REFERRAL_FEE(), "referral paid once");
        assertEq(launch.referralUnclaimed(address(p)), 0);
    }

    // ================================================================ pending accounting while in flight
    /// While requests are in flight on the wrapper, each pending spin keeps 10x booked, so concurrent
    /// enters shrink `availableTwak` / `maxEntry` and can never overdraw, whatever the answer order.
    function testFuzz_DrawV2PendingReservationHoldsInFlight(uint256 salt, uint8 nRaw) public {
        uint256 n = bound(nRaw, 2, 25);
        DrawV2 d = new DrawV2(address(timelock), address(token), vrfCfg(DRAW_CALLBACK_GAS));
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
            (, reqs[count]) = d.enter{value: drawFee}(amt);
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
            d.enter{value: drawFee}(cap + 1);
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
            genesis.mint{value: genesisFee}(tid);
        }
        genesis.close();
        assertEq(genesis.committed(), 3 * genesis.MAX_EXTRA(), "3 pending x 80k worst case");
        genesis.sweepSurplus();
        assertEq(token.balanceOf(address(genesis)), 3 * 80_000e18);
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();

        vm.warp(block.timestamp + 1 hours);
        genesis.retryPrize{value: genesisFee}(bob); // retry after close is still allowed
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

    /// Launch: pending mints block the listing until the wrapper answers (or a retry is answered).
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
        launch.retryPrize{value: launchFee}(user(1));
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
        (spinId, req) = drawV2.enter{value: drawFee}(amt);
    }

    function _cfgFor(uint32 gasLimit, address wrapper) internal view returns (VRFConsumerV25.VRFConfig memory c) {
        c = vrfCfg(gasLimit);
        c.wrapper = wrapper;
    }

    /// Fulfils through the wrapper mock and returns the gas consumed by its exact-gas CALL into the consumer.
    function _callbackGas(address consumer, uint256 req, uint256 word) internal returns (uint256) {
        fulfillTo(consumer, req, word);
        return vrf.lastCallbackGasUsed();
    }
}
