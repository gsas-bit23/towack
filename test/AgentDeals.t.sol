// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Fixture} from "./Fixture.sol";
import {AgentDeals} from "../src/AgentDeals.sol";

/// Mainnet-shaped Agent ID registry (SPACE ID HandleRegistry): one soulbound handle per address,
/// tokenId = uint256(keccak256(bytes(handle))), ownerOf reverts for unknown ids.
contract MockHandleRegistry {
    mapping(uint256 => address) internal owners;
    mapping(address => string) public handleOf;

    function register(address who, string memory handle) external returns (uint256 id) {
        id = uint256(keccak256(bytes(handle)));
        require(owners[id] == address(0) && bytes(handleOf[who]).length == 0, "taken");
        owners[id] = who;
        handleOf[who] = handle;
    }

    function balanceOf(address who) external view returns (uint256) {
        return bytes(handleOf[who]).length > 0 ? 1 : 0;
    }

    function ownerOf(uint256 id) external view returns (address o) {
        o = owners[id];
        require(o != address(0), "ERC721NonexistentToken");
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return owners[uint256(keccak256(bytes(handle)))];
    }
}

contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Token that delivers less than requested (fee-on-transfer); must be rejected on accept.
contract TaxToken is ERC20 {
    constructor() ERC20("Tax", "TAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            super._update(from, address(0xdead), value / 100);
            value -= value / 100;
        }
        super._update(from, to, value);
    }
}

contract AgentDealsTest is Fixture {
    AgentDeals deals;
    MockHandleRegistry reg;
    MockUSDT usdt;

    address provider = makeAddr("provider");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");
    address treasury = makeAddr("treasury");
    uint256 providerId;
    uint256 clientId;

    uint64 constant WINDOW = 2 days;
    bytes32 constant TERMS = keccak256("write a market summary");
    bytes32 constant DELIVERY = keccak256("ipfs://summary");

    function setUp() public override {
        super.setUp();
        reg = new MockHandleRegistry();
        usdt = new MockUSDT();
        providerId = reg.register(provider, "builder");
        clientId = reg.register(client, "buyer");
        deals = new AgentDeals(address(reg), address(token), address(usdt), treasury, address(drawV2));

        usdt.mint(client, 1_000_000e18);
        vm.prank(seasons);
        token.transfer(client, 10_000_000e18);
        vm.prank(client);
        usdt.approve(address(deals), type(uint256).max);
        vm.prank(client);
        token.approve(address(deals), type(uint256).max);
    }

    function _offer(address tok, uint256 amount) internal returns (uint256 id) {
        vm.prank(provider);
        id = deals.createOffer(tok, amount, clientId, WINDOW, TERMS);
    }

    function _funded(address tok, uint256 amount) internal returns (uint256 id) {
        id = _offer(tok, amount);
        vm.prank(client);
        deals.accept(id);
    }

    function _status(uint256 id) internal view returns (AgentDeals.Status s) {
        (,,,,,,,,,, s) = deals.deals(id);
    }

    // ---------------------------------------------------------------- happy paths + fee split
    function test_UsdtDeal_FullFlow_FeeAllToTreasury() public {
        uint256 id = _funded(address(usdt), 1_000e18);
        assertEq(usdt.balanceOf(address(deals)), 1_000e18);
        vm.prank(provider);
        deals.deliver(id, DELIVERY);
        vm.prank(client);
        deals.release(id);

        assertEq(usdt.balanceOf(provider), 990e18);
        assertEq(usdt.balanceOf(treasury), 10e18);
        assertEq(usdt.balanceOf(address(deals)), 0);
        assertEq(uint8(_status(id)), uint8(AgentDeals.Status.Paid));
        assertEq(deals.paidVolume(address(usdt)), 1_000e18);
        assertEq(deals.feesCollected(address(usdt)), 10e18);
    }

    function test_TwakDeal_FullFlow_FeeSplit_TreasuryAndDrawV2Seed() public {
        uint256 poolBefore = token.balanceOf(address(drawV2));
        uint256 seededBefore = drawV2.totalSeeded();
        uint256 id = _funded(address(token), 100_000e18);
        vm.prank(client);
        deals.release(id);

        assertEq(token.balanceOf(provider), 99_000e18); // 99%
        assertEq(token.balanceOf(treasury), 800e18); // 0.8%
        assertEq(token.balanceOf(address(drawV2)) - poolBefore, 200e18); // 0.2% into the prize pool
        assertEq(drawV2.totalSeeded() - seededBefore, 200e18);
        assertEq(token.allowance(address(deals), address(drawV2)), 0);
        assertEq(token.balanceOf(address(deals)), 0);
    }

    function test_FeeSplitView() public view {
        (uint256 p, uint256 t, uint256 d) = deals.feeSplit(address(token), 1_000e18);
        assertEq(p, 990e18);
        assertEq(t, 8e18);
        assertEq(d, 2e18);
        (p, t, d) = deals.feeSplit(address(usdt), 1_000e18);
        assertEq(p, 990e18);
        assertEq(t, 10e18);
        assertEq(d, 0);
    }

    function test_ReleaseBeforeDelivery_Allowed() public {
        uint256 id = _funded(address(usdt), 100e18);
        vm.prank(client);
        deals.release(id);
        assertEq(usdt.balanceOf(provider), 99e18);
    }

    function test_ProviderClaim_AfterReviewWindow() public {
        uint256 id = _funded(address(usdt), 100e18);
        vm.prank(provider);
        deals.deliver(id, DELIVERY);
        vm.warp(block.timestamp + 3 days - 1);
        vm.prank(provider);
        vm.expectRevert(AgentDeals.TooEarly.selector);
        deals.claimPayment(id);
        vm.warp(block.timestamp + 1);
        vm.prank(provider);
        deals.claimPayment(id);
        assertEq(usdt.balanceOf(provider), 99e18);
        assertEq(usdt.balanceOf(treasury), 1e18);
    }

    // ---------------------------------------------------------------- refunds
    function test_ClientRefund_AfterMissedDeadline_NoFee() public {
        uint256 id = _funded(address(usdt), 500e18);
        uint256 bal = usdt.balanceOf(client);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(client);
        vm.expectRevert(AgentDeals.TooEarly.selector);
        deals.refund(id);
        vm.warp(block.timestamp + 1);
        vm.prank(provider);
        vm.expectRevert(AgentDeals.PastDeadline.selector);
        deals.deliver(id, DELIVERY);
        vm.prank(client);
        deals.refund(id);
        assertEq(usdt.balanceOf(client), bal + 500e18);
        assertEq(usdt.balanceOf(treasury), 0);
        assertEq(uint8(_status(id)), uint8(AgentDeals.Status.Refunded));
    }

    function test_ClientCannotRefund_AfterDelivery() public {
        uint256 id = _funded(address(usdt), 500e18);
        vm.prank(provider);
        deals.deliver(id, DELIVERY);
        vm.warp(block.timestamp + 30 days);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(AgentDeals.WrongStatus.selector, AgentDeals.Status.Delivered));
        deals.refund(id);
    }

    function test_ProviderRefund_AnyTimeBeforePayout() public {
        uint256 id = _funded(address(token), 1_000e18);
        uint256 bal = token.balanceOf(client);
        vm.prank(provider);
        deals.deliver(id, DELIVERY);
        vm.prank(provider);
        deals.refundByProvider(id);
        assertEq(token.balanceOf(client), bal + 1_000e18);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(AgentDeals.WrongStatus.selector, AgentDeals.Status.Refunded));
        deals.release(id);
    }

    // ---------------------------------------------------------------- offers / access
    function test_CancelOffer_ThenCannotAccept() public {
        uint256 id = _offer(address(usdt), 10e18);
        vm.prank(stranger);
        vm.expectRevert(AgentDeals.NotProvider.selector);
        deals.cancelOffer(id);
        vm.prank(provider);
        deals.cancelOffer(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(AgentDeals.WrongStatus.selector, AgentDeals.Status.Cancelled));
        deals.accept(id);
    }

    function test_OnlyTheTargetAgentIdCanAccept() public {
        uint256 id = _offer(address(usdt), 10e18);
        reg.register(stranger, "someone");
        usdt.mint(stranger, 10e18);
        vm.startPrank(stranger);
        usdt.approve(address(deals), 10e18);
        vm.expectRevert(AgentDeals.NotClientAgent.selector);
        deals.accept(id);
        vm.stopPrank();
    }

    function test_ProviderNeedsAgentId() public {
        vm.prank(stranger);
        vm.expectRevert(AgentDeals.NoAgentId.selector);
        deals.createOffer(address(usdt), 1e18, clientId, WINDOW, TERMS);
    }

    function test_OfferChecks() public {
        vm.startPrank(provider);
        vm.expectRevert(AgentDeals.UnsupportedToken.selector);
        deals.createOffer(address(wbnb), 1e18, clientId, WINDOW, TERMS);
        vm.expectRevert(AgentDeals.ZeroAmount.selector);
        deals.createOffer(address(usdt), 0, clientId, WINDOW, TERMS);
        vm.expectRevert(AgentDeals.BadWindow.selector);
        deals.createOffer(address(usdt), 1e18, clientId, 59 minutes, TERMS);
        vm.expectRevert(AgentDeals.BadWindow.selector);
        deals.createOffer(address(usdt), 1e18, clientId, 61 days, TERMS);
        vm.expectRevert(AgentDeals.SelfDeal.selector);
        deals.createOffer(address(usdt), 1e18, providerId, WINDOW, TERMS);
        vm.expectRevert(AgentDeals.NotClientAgent.selector);
        deals.createOffer(address(usdt), 1e18, uint256(keccak256("nobody")), WINDOW, TERMS);
        vm.stopPrank();
    }

    function test_OnlyPartiesCanMoveTheDeal() public {
        uint256 id = _funded(address(usdt), 10e18);
        vm.startPrank(stranger);
        vm.expectRevert(AgentDeals.NotProvider.selector);
        deals.deliver(id, DELIVERY);
        vm.expectRevert(AgentDeals.NotClient.selector);
        deals.release(id);
        vm.expectRevert(AgentDeals.NotClient.selector);
        deals.refund(id);
        vm.expectRevert(AgentDeals.NotProvider.selector);
        deals.refundByProvider(id);
        vm.expectRevert(AgentDeals.NotProvider.selector);
        deals.claimPayment(id);
        vm.stopPrank();
    }

    function test_CannotPayTwice() public {
        uint256 id = _funded(address(usdt), 10e18);
        vm.prank(client);
        deals.release(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(AgentDeals.WrongStatus.selector, AgentDeals.Status.Paid));
        deals.release(id);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AgentDeals.WrongStatus.selector, AgentDeals.Status.Paid));
        deals.refundByProvider(id);
    }

    function test_RejectsFeeOnTransferToken() public {
        TaxToken tax = new TaxToken();
        AgentDeals d2 = new AgentDeals(address(reg), address(tax), address(usdt), treasury, address(drawV2));
        tax.mint(client, 100e18);
        vm.prank(provider);
        uint256 id = d2.createOffer(address(tax), 100e18, clientId, WINDOW, TERMS);
        vm.startPrank(client);
        tax.approve(address(d2), 100e18);
        vm.expectRevert(AgentDeals.BadTransferAmount.selector);
        d2.accept(id);
        vm.stopPrank();
    }

    function test_ConstructorRejectsZero() public {
        vm.expectRevert(AgentDeals.ZeroAddress.selector);
        new AgentDeals(address(0), address(token), address(usdt), treasury, address(drawV2));
        vm.expectRevert(AgentDeals.ZeroAddress.selector);
        new AgentDeals(address(reg), address(token), address(usdt), address(0), address(drawV2));
    }

    // ---------------------------------------------------------------- conservation
    /// Every unit that enters a deal leaves to exactly the provider + treasury + Draw V2 (paid) or the client
    /// (refunded); nothing is left behind and the fee never exceeds 1%.
    function testFuzz_Conservation(uint256 amount, bool useTwak, uint8 path) public {
        address tok = useTwak ? address(token) : address(usdt);
        amount = bound(amount, 1, useTwak ? 5_000_000e18 : 500_000e18);
        uint256 clientBefore = ERC20(tok).balanceOf(client);
        uint256 poolBefore = token.balanceOf(address(drawV2));

        uint256 id = _funded(tok, amount);
        path = path % 3;
        if (path == 0) {
            vm.prank(client);
            deals.release(id);
        } else if (path == 1) {
            vm.prank(provider);
            deals.deliver(id, DELIVERY);
            vm.warp(block.timestamp + 3 days);
            vm.prank(provider);
            deals.claimPayment(id);
        } else {
            vm.warp(block.timestamp + WINDOW + 1);
            vm.prank(client);
            deals.refund(id);
        }

        assertEq(ERC20(tok).balanceOf(address(deals)), 0);
        uint256 toProvider = ERC20(tok).balanceOf(provider);
        uint256 toTreasury = ERC20(tok).balanceOf(treasury);
        uint256 toDraw = useTwak ? token.balanceOf(address(drawV2)) - poolBefore : 0;
        uint256 back = ERC20(tok).balanceOf(client) - (clientBefore - amount);
        assertEq(toProvider + toTreasury + toDraw + back, amount);
        if (path == 2) {
            assertEq(back, amount);
        } else {
            assertLe(toTreasury + toDraw, amount / 100);
            assertEq(toProvider, amount - amount / 100);
        }
    }
}
