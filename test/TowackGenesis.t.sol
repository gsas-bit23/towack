// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "./Fixture.sol";
import {TowackGenesis} from "../src/TowackGenesis.sol";
import {MockAgentIdNFT} from "../src/mocks/MockAgentIdNFT.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Mirrors the verified BSC mainnet SPACE ID HandleRegistry (0x60B9…022F): soulbound ERC-721 where
/// `tokenId = uint256(keccak256(bytes(handle)))`, `handleOf(addr)` and `ownerOfHandle(handle)` exist, and
/// ERC721Enumerable is NOT implemented.
contract MockHandleRegistry is ERC721 {
    mapping(address => string) public handleOf;

    constructor() ERC721("SPACE ID Agent ID", "AI") {}

    function adminRegister(string calldata handle, address to) external {
        require(bytes(handleOf[to]).length == 0, "has handle");
        bytes32 label = keccak256(bytes(handle));
        handleOf[to] = handle;
        _mint(to, uint256(label));
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return _ownerOf(uint256(keccak256(bytes(handle))));
    }
}

/// @dev ERC-20 with a transfer hook: every transfer to `hooked` calls back into it, so a minter contract can
/// try to re-enter Genesis while its 20k TWAK is being sent.
contract HookToken is ERC20 {
    address public hooked;

    constructor() ERC20("Hook", "HOOK") {
        _mint(msg.sender, 100_000_000e18);
    }

    function setHooked(address h) external {
        hooked = h;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to == hooked && hooked != address(0)) ReentrantMinter(hooked).onReceive();
    }
}

/// @dev Owns two Agent IDs; on receiving TWAK tries to claim again with the second id.
contract ReentrantMinter {
    TowackGenesis public g;
    bytes public reenterCall;
    bool public reenterSucceeded;
    bytes public reenterRevertData;
    uint256 public attempts;

    function setUp(TowackGenesis g_, bytes calldata call_) external {
        g = g_;
        reenterCall = call_;
    }

    function mint(uint256 id) external {
        g.mint(id);
    }

    function onReceive() external {
        if (address(g) == address(0) || reenterCall.length == 0) return;
        ++attempts;
        (bool ok, bytes memory data) = address(g).call(reenterCall);
        reenterSucceeded = ok;
        reenterRevertData = data;
    }
}

contract TowackGenesisTest is Fixture {
    TowackGenesis genesis;
    MockAgentIdNFT nft;

    uint256 constant BASE = 20_000e18;
    uint256 constant BUDGET = 6_000_000e18;

    function setUp() public override {
        super.setUp();
        nft = new MockAgentIdNFT();
        genesis = new TowackGenesis(address(token), address(nft), ecosystem, address(this));
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

    function _mintN(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            (address u, uint256 id) = _newHolder(i);
            _mint(u, id);
        }
    }

    function _assertSolvent() internal view {
        assertGe(token.balanceOf(address(genesis)), genesis.committed(), "solvent");
        assertLe(genesis.totalClaimed(), BUDGET, "<= 6M");
    }

    // ---------------------------------------------------------------- constants
    function test_Constants() public view {
        assertEq(genesis.MAX_MINTS(), 300);
        assertEq(genesis.BASE_TOKENS(), 20_000e18);
        assertEq(genesis.BUDGET(), 6_000_000e18);
        assertEq(genesis.BUDGET(), genesis.MAX_MINTS() * genesis.BASE_TOKENS());
        assertEq(BUDGET * 100 / token.ECOSYSTEM(), 12, "12% of ecosystem");
        assertEq(address(genesis.token()), address(token));
        assertEq(address(genesis.agentId()), address(nft));
        assertEq(genesis.ecosystemWallet(), ecosystem);
        assertEq(genesis.owner(), address(this));
    }

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(bytes("zero addr"));
        new TowackGenesis(address(0), address(nft), ecosystem, address(this));
        vm.expectRevert(bytes("zero addr"));
        new TowackGenesis(address(token), address(0), ecosystem, address(this));
        vm.expectRevert(bytes("zero addr"));
        new TowackGenesis(address(token), address(nft), address(0), address(this));
    }

    // ---------------------------------------------------------------- happy path
    function test_MintIsInstantFlat20k_GasOnly() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        assertEq(u.balance, 0, "minter holds no BNB at all");
        uint256 g0 = token.balanceOf(address(genesis));
        vm.expectEmit(true, true, true, true, address(genesis));
        emit TowackGenesis.GenesisMinted(u, 1, id, BASE);
        _mint(u, id);
        assertEq(token.balanceOf(u), BASE, "20k TWAK in the same tx");
        assertEq(token.balanceOf(address(genesis)), g0 - BASE);
        assertEq(genesis.mintCount(), 1);
        assertTrue(genesis.hasMinted(u));
        assertEq(genesis.mintIndexOf(u), 1);
        assertTrue(genesis.tokenIdUsed(id));
        assertEq(genesis.totalClaimed(), BASE);
        assertEq(genesis.remainingMints(), 299);
        assertEq(genesis.committed(), 299 * BASE);
        assertEq(address(genesis).balance, 0, "no BNB");
        _assertSolvent();
    }

    /// mint() and mintByHandle() are non-payable; plain BNB is rejected too.
    function test_NonPayable_RejectsAnyBnb() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        vm.deal(u, 1 ether);
        vm.prank(u);
        (bool ok,) = address(genesis).call{value: 1 wei}(abi.encodeCall(TowackGenesis.mint, (id)));
        assertFalse(ok, "mint with value reverts");
        vm.prank(u);
        (ok,) = address(genesis).call{value: 1 wei}(abi.encodeCall(TowackGenesis.mintByHandle, ()));
        assertFalse(ok, "mintByHandle with value reverts");
        vm.prank(u);
        (ok,) = address(genesis).call{value: 1 ether}("");
        assertFalse(ok, "plain BNB rejected");
        assertEq(genesis.mintCount(), 0);
        // the same call with 0 BNB works
        _mint(u, id);
        assertEq(u.balance, 1 ether, "no BNB spent beyond gas (gas price is not charged in tests)");
        assertEq(address(genesis).balance, 0);
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
        vm.expectRevert(TowackGenesis.NotOpen.selector);
        genesis.close();

        _fund(BUDGET); // the closed-window sweep would have been possible; reopening needs the remaining claims
        genesis.open();
        _mint(u, id);
        assertEq(genesis.mintCount(), 1);
    }

    function test_OpenCloseEvents() public {
        _fund(BUDGET);
        vm.expectEmit(false, false, false, true, address(genesis));
        emit TowackGenesis.WindowOpened(BUDGET, BUDGET);
        genesis.open();
        vm.expectEmit(false, false, false, true, address(genesis));
        emit TowackGenesis.WindowClosed(0);
        genesis.close();
    }

    function test_OnlyOwnerOpensClosesSweeps() public {
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
        vm.prank(address(timelock));
        genesis.sweepSurplus();
        assertEq(token.balanceOf(address(genesis)), 0);
    }

    function test_RenounceDisabled() public {
        vm.expectRevert(TowackGenesis.RenounceDisabled.selector);
        genesis.renounceOwnership();
        vm.prank(makeAddr("rando"));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, makeAddr("rando")));
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
        assertFalse(genesis.tokenIdUsed(id), "failed attempt marks nothing");
        assertFalse(genesis.hasMinted(noNft));
    }

    function test_DoubleClaim_SameWalletSameToken() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        _mint(u, id);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        genesis.mint(id);
        assertEq(token.balanceOf(u), BASE, "still exactly one grant");
    }

    function test_DoubleClaim_WalletWithSecondToken() public {
        _fundAndOpen();
        (address u, uint256 id) = _newHolder(0);
        uint256 id2 = nft.registerFor(u);
        _mint(u, id);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        genesis.mint(id2);
        assertFalse(genesis.tokenIdUsed(id2));
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
        assertEq(token.balanceOf(fresh), BASE);
    }

    // ---------------------------------------------------------------- funding / solvency
    function test_FundPullsFromCallerAndEmits() public {
        vm.prank(ecosystem);
        token.approve(address(genesis), BUDGET);
        vm.expectEmit(true, false, false, true, address(genesis));
        emit TowackGenesis.BudgetFunded(ecosystem, BUDGET, BUDGET);
        vm.prank(ecosystem);
        genesis.fund(BUDGET);
        assertEq(genesis.totalFunded(), BUDGET);
        assertEq(token.balanceOf(address(genesis)), BUDGET);

        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.fund(0);
        // no approval -> reverts
        vm.prank(makeAddr("broke"));
        vm.expectRevert();
        genesis.fund(1);
    }

    function test_UnderfundedCannotOpen() public {
        _fund(BUDGET - 1);
        vm.expectRevert(abi.encodeWithSelector(TowackGenesis.Underfunded.selector, BUDGET - 1, BUDGET));
        genesis.open();
        assertFalse(genesis.isOpen());
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
        assertEq(token.balanceOf(address(launch)), launchBal);
        assertEq(token.balanceOf(address(drawV2)), drawBal);
        assertEq(token.balanceOf(token.pair()), pairBal);
        assertEq(token.balanceOf(ecosystem), ecoBal - BUDGET);
    }

    function test_CommittedTracksRemainingClaims() public {
        assertEq(genesis.committed(), 0, "closed: nothing owed");
        _fundAndOpen();
        assertEq(genesis.committed(), BUDGET);
        _mintN(7);
        assertEq(genesis.committed(), (300 - 7) * BASE);
        assertEq(token.balanceOf(address(genesis)), genesis.committed(), "exactly funded stays exact");
        genesis.close();
        assertEq(genesis.committed(), 0, "closed: every claim was already paid");
        assertEq(genesis.surplus(), (300 - 7) * BASE);
    }

    function test_Cap_300Succeed_301stReverts_ContractEmpties() public {
        uint256[11] memory launchDeck = launch.remainingCounts();
        uint256 launchBal = token.balanceOf(address(launch));
        _fundAndOpen();
        _mintN(300);
        assertEq(genesis.mintCount(), 300);
        assertFalse(genesis.isOpen(), "auto-closes at sellout");
        assertEq(genesis.totalClaimed(), BUDGET, "sellout hands out exactly 6M");
        assertEq(token.balanceOf(address(genesis)), 0, "contract empty");
        for (uint256 i; i < 300; i += 37) {
            assertEq(token.balanceOf(gUser(i)), BASE);
        }

        (address u301, uint256 id301) = _newHolder(300);
        vm.prank(u301);
        vm.expectRevert(TowackGenesis.NotOpen.selector);
        genesis.mint(id301);
        vm.expectRevert(TowackGenesis.SoldOut.selector);
        genesis.open();
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();

        // paid deck untouched
        uint256[11] memory after_ = launch.remainingCounts();
        for (uint256 k; k < 11; ++k) {
            assertEq(after_[k], launchDeck[k]);
        }
        assertEq(launch.remainingTotal(), 5000);
        assertEq(token.balanceOf(address(launch)), launchBal);
    }

    function test_SellOutEmitsWindowClosed() public {
        _fundAndOpen();
        _mintN(299);
        (address u, uint256 id) = _newHolder(299);
        vm.expectEmit(false, false, false, true, address(genesis));
        emit TowackGenesis.WindowClosed(300);
        _mint(u, id);
        assertFalse(genesis.isOpen());
    }

    /// After sellout the window can never reopen, even with an overfund.
    function test_CannotReopenAfterSellout() public {
        _fundAndOpen();
        _mintN(300);
        _fund(BASE);
        vm.expectRevert(TowackGenesis.SoldOut.selector);
        genesis.open();
    }

    function test_EarlyClose_SweepReturnsEverythingUnclaimed() public {
        _fundAndOpen();
        _mintN(10);
        genesis.close();
        uint256 bal = token.balanceOf(address(genesis));
        assertEq(bal, BUDGET - 10 * BASE);
        uint256 ecoBefore = token.balanceOf(ecosystem);
        vm.expectEmit(true, false, false, true, address(genesis));
        emit TowackGenesis.SurplusSwept(ecosystem, bal);
        uint256 swept = genesis.sweepSurplus();
        assertEq(swept, bal);
        assertEq(genesis.totalSwept(), bal);
        assertEq(token.balanceOf(ecosystem), ecoBefore + bal);
        assertEq(token.balanceOf(address(genesis)), 0);
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();

        // reopening requires refunding the remaining claims
        uint256 need = (300 - 10) * BASE;
        vm.expectRevert(abi.encodeWithSelector(TowackGenesis.Underfunded.selector, 0, need));
        genesis.open();
        _fund(need);
        genesis.open();
        (address u, uint256 id) = _newHolder(10);
        _mint(u, id);
        assertEq(genesis.mintCount(), 11);
    }

    function test_SweepWhileOpenOnlyOverfund() public {
        _fund(BUDGET + 123e18);
        genesis.open();
        assertEq(genesis.surplus(), 123e18);
        assertEq(genesis.sweepSurplus(), 123e18);
        assertEq(genesis.surplus(), 0);
        vm.expectRevert(TowackGenesis.ZeroAmount.selector);
        genesis.sweepSurplus();
        _mintN(3);
        assertEq(genesis.surplus(), 0);
        _assertSolvent();
    }

    // ---------------------------------------------------------------- reentrancy
    function test_Reentrancy_ReenterDuringTokenTransferBlocked() public {
        HookToken ht = new HookToken();
        TowackGenesis g = new TowackGenesis(address(ht), address(nft), ecosystem, address(this));
        ht.approve(address(g), BUDGET);
        g.fund(BUDGET);
        g.open();

        ReentrantMinter m = new ReentrantMinter();
        uint256 t1 = nft.registerFor(address(m));
        uint256 t2 = nft.registerFor(address(m)); // second Agent ID for the re-entry attempt
        ht.setHooked(address(m));

        bytes[3] memory calls = [
            abi.encodeCall(TowackGenesis.mint, (t2)),
            abi.encodeCall(TowackGenesis.mintByHandle, ()),
            abi.encodeCall(TowackGenesis.fund, (1))
        ];
        for (uint256 i; i < 3; ++i) {
            uint256 snap = vm.snapshotState();
            m.setUp(g, calls[i]);
            m.mint(t1);
            assertEq(m.attempts(), 1);
            assertFalse(m.reenterSucceeded(), "re-entry blocked");
            assertEq(
                m.reenterRevertData(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            );
            assertEq(g.mintCount(), 1, "no second claim via re-entry");
            assertEq(ht.balanceOf(address(m)), BASE);
            assertFalse(g.tokenIdUsed(t2));
            vm.revertToState(snap);
        }
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_MintFlowSolvent(uint256 n, uint256 extraFund) public {
        n = bound(n, 1, 120);
        extraFund = bound(extraFund, 0, 1_000_000e18);
        _fund(BUDGET + extraFund);
        genesis.open();
        assertEq(genesis.surplus(), extraFund);
        _mintN(n);
        _assertSolvent();
        assertEq(genesis.totalClaimed(), n * BASE);
        assertEq(token.balanceOf(address(genesis)), BUDGET + extraFund - n * BASE);
        genesis.close();
        uint256 ecoBefore = token.balanceOf(ecosystem);
        genesis.sweepSurplus();
        assertEq(token.balanceOf(address(genesis)), 0, "empty after close + sweep");
        assertEq(token.balanceOf(ecosystem) - ecoBefore, BUDGET + extraFund - n * BASE);
    }

    // ---------------------------------------------------------------- mainnet HandleRegistry compatibility
    function test_MintByHandle_HandleRegistryCompatibleAndBlocksDoubleMint() public {
        MockHandleRegistry reg = new MockHandleRegistry();
        TowackGenesis g = new TowackGenesis(address(token), address(reg), ecosystem, address(this));
        vm.startPrank(ecosystem);
        token.approve(address(g), BUDGET);
        g.fund(BUDGET);
        vm.stopPrank();
        g.open();

        address alice = makeAddr("aliceHandle");
        address bob = makeAddr("bobHandle");
        address noHandle = makeAddr("noHandle");

        reg.adminRegister("aliceagent", alice);
        reg.adminRegister("bobagent", bob);
        uint256 aliceTid = uint256(keccak256(bytes("aliceagent")));
        uint256 bobTid = uint256(keccak256(bytes("bobagent")));

        // No handle reverts NotAgentOwner
        vm.prank(noHandle);
        vm.expectRevert(TowackGenesis.NotAgentOwner.selector);
        g.mintByHandle();

        // Alice uses mintByHandle() -> derives keccak256("aliceagent"), marks tokenIdUsed & wallet used
        vm.prank(alice);
        g.mintByHandle();
        assertEq(g.mintCount(), 1);
        assertTrue(g.tokenIdUsed(aliceTid));
        assertEq(token.balanceOf(alice), BASE);

        // Alice cannot double-mint via mint(tokenId) or mintByHandle()
        vm.prank(alice);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        g.mint(aliceTid);
        vm.prank(alice);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        g.mintByHandle();

        // Bob uses mint(tokenId) directly -> works and blocks mintByHandle()
        vm.prank(bob);
        g.mint(bobTid);
        assertEq(g.mintCount(), 2);
        assertTrue(g.tokenIdUsed(bobTid));
        assertEq(token.balanceOf(bob), BASE);
        vm.prank(bob);
        vm.expectRevert(TowackGenesis.AlreadyMinted.selector);
        g.mintByHandle();
    }

    function test_MintByHandle_RevertsOnMockWithoutHandleOf() public {
        _fundAndOpen();
        (address u,) = _newHolder(0);
        vm.prank(u);
        vm.expectRevert(TowackGenesis.NotAgentOwner.selector);
        genesis.mintByHandle();
    }
}
