// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TowackToken} from "../../src/TowackToken.sol";
import {TowackLaunch} from "../../src/TowackLaunch.sol";
import {TowackRouter} from "../../src/TowackRouter.sol";
import {RebateDistributor} from "../../src/RebateDistributor.sol";
import {TeamVesting} from "../../src/TeamVesting.sol";
import {DrawV2} from "../../src/DrawV2.sol";
import {TowackGenesis} from "../../src/TowackGenesis.sol";
import {VRFConsumerV25} from "../../src/VRFConsumerV25.sol";
import {IAgentId} from "../../src/interfaces/IAgentId.sol";
import {IPancakePair} from "../../src/interfaces/IPancakeV2.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";

interface IMainnetWrapperCallbacks {
    function s_callbacks(uint256 id) external view returns (address callbackAddress, uint32 callbackGasLimit, uint64 requestGasPrice);
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @notice BSC MAINNET (chain 56) full-stack fork test against the REAL verified mainnet dependencies:
///  - SPACE ID HandleRegistry (Agent ID): 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
///  - Chainlink VRFV2PlusWrapper 1.0.0:   0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94
///  - Chainlink VRFCoordinatorV2_5:       0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9
///  - PancakeSwap v2 Factory / Router:    0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73 / 0x10ED43C718714eb63d5aA57B78B54704E256024E
///  - WBNB:                               0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
///
/// Gated behind BSC_MAINNET_FORK=1 so offline `forge test` skips it cleanly.
///   BSC_MAINNET_FORK=1 forge test --match-contract ForkMainnetFullStack -vv
contract ForkMainnetFullStackTest is Test {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant VRF_WRAPPER = 0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94;
    address constant VRF_COORDINATOR = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
    address constant PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;

    /// Real on-chain Agent ID holders observed on BSC mainnet HandleRegistry at block 135,163,386.
    address constant REAL_HOLDER_1 = 0x56a9813E93363fb5141bdDD332f9BBbdC955e2b8; // handle "delben96"
    address constant REAL_HOLDER_2 = 0xecdC514998d7249eE430CCE62E9484672d337bC6;

    bytes32 constant FAILED_SIG = keccak256("WrapperFulfillmentFailed(uint256,address)");

    function _fulfillViaRealWrapper(uint256 reqId, uint256 word) internal {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        vm.recordLogs();
        vm.prank(VRF_COORDINATOR);
        IMainnetWrapperCallbacks(VRF_WRAPPER).rawFulfillRandomWords(reqId, words);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != FAILED_SIG, "WrapperFulfillmentFailed emitted by real mainnet wrapper");
        }
    }

    function test_MainnetForkFullLifecycle() public {
        if (!vm.envOr("BSC_MAINNET_FORK", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("BSC_MAINNET_RPC", string("https://bsc-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 56, "chain 56");

        // Verify real holders on real HandleRegistry
        IAgentId reg = IAgentId(AGENT_ID);
        assertEq(reg.balanceOf(REAL_HOLDER_1), 1, "holder 1 balance");
        assertEq(reg.balanceOf(REAL_HOLDER_2), 1, "holder 2 balance");
        string memory h1 = reg.handleOf(REAL_HOLDER_1);
        string memory h2 = reg.handleOf(REAL_HOLDER_2);
        assertGt(bytes(h1).length, 0, "holder 1 handle");
        assertGt(bytes(h2).length, 0, "holder 2 handle");
        assertEq(reg.ownerOfHandle(h1), REAL_HOLDER_1);
        assertEq(reg.ownerOf(uint256(keccak256(bytes(h2)))), REAL_HOLDER_2);

        // Deploy full mainnet stack with designed params
        vm.txGasPrice(0.1 gwei);
        address proposer = makeAddr("proposerMultisig");
        address seasons = makeAddr("seasonsMultisig");
        address ecosystem = address(this);
        address polBuffer = makeAddr("polMultisig");
        address teamBen = makeAddr("teamMultisig");
        address dev = makeAddr("devMultisig");

        address[] memory roles = new address[](1);
        roles[0] = proposer;
        TimelockController timelock = new TimelockController(48 hours, roles, roles, address(0));
        DrawV2 drawV2 = new DrawV2(address(timelock), address(0), VRFConsumerV25.VRFConfig(VRF_WRAPPER, 3, 200_000));
        TowackLaunch launch = new TowackLaunch(
            AGENT_ID,
            WBNB,
            address(drawV2),
            block.timestamp,
            block.timestamp + 7 days,
            VRFConsumerV25.VRFConfig(VRF_WRAPPER, 3, 165_000),
            false
        );
        RebateDistributor rebates = new RebateDistributor();
        TeamVesting team = new TeamVesting(teamBen);
        TowackToken token = new TowackToken(
            TowackToken.Recipients(
                address(launch), address(rebates), address(team), address(drawV2), seasons, ecosystem, polBuffer
            ),
            PANCAKE_FACTORY,
            WBNB
        );
        launch.bindToken(address(token));
        team.bindToken(address(token));
        drawV2.bindToken(address(token));
        TowackRouter router =
            new TowackRouter(address(token), PANCAKE_ROUTER, AGENT_ID, address(rebates), address(drawV2), dev);
        rebates.bind(address(token), address(router));
        rebates.setRouterAdmin(address(timelock));
        TowackGenesis genesis = new TowackGenesis(
            address(token), AGENT_ID, ecosystem, address(this), VRFConsumerV25.VRFConfig(VRF_WRAPPER, 3, 170_000)
        );
        token.approve(address(genesis), 8_000_000e18);
        genesis.fund(8_000_000e18);
        genesis.open();

        // 1. Referred paid mint (holder 2 referred by holder 1) + non-agent rejection
        address nonAgent = makeAddr("nonAgent");
        uint256 launchFee = launch.vrfFeeAt(0.1 gwei);
        uint256 launchExact = IVRFV2PlusWrapper(VRF_WRAPPER).calculateRequestPriceNative(165_000, 1);
        assertGt(launchExact, 0);
        vm.deal(nonAgent, 1 ether);
        vm.prank(nonAgent);
        vm.expectRevert(TowackLaunch.NoAgentId.selector);
        launch.mint{value: 0.1 ether + launchFee}();

        vm.deal(REAL_HOLDER_2, 2 ether);
        uint256 h2Before = REAL_HOLDER_2.balance;
        uint256 wBefore = VRF_WRAPPER.balance;
        vm.prank(REAL_HOLDER_2);
        launch.mint{value: 0.1 ether + launchFee}(REAL_HOLDER_1);
        assertEq(token.balanceOf(REAL_HOLDER_2), 80_000e18, "instant 80k TWAK");
        assertEq(VRF_WRAPPER.balance - wBefore, launchExact, "real wrapper got exact price");
        assertEq(h2Before - REAL_HOLDER_2.balance, 0.1 ether + launchExact, "excess refunded");
        assertEq(launch.referralUnclaimed(REAL_HOLDER_1), 0.005 ether, "5% referral accrued");

        // Second paid mint (holder 1, no referrer) so LP has ample BNB after refunds
        vm.deal(REAL_HOLDER_1, 2 ether);
        vm.prank(REAL_HOLDER_1);
        launch.mint{value: 0.1 ether + launchFee}(address(0));

        // Fulfill both Launch VRF requests via real mainnet coordinator -> real mainnet wrapper
        (,,,,, uint256 req2) = launch.tickets(REAL_HOLDER_2);
        (,,,,, uint256 req1) = launch.tickets(REAL_HOLDER_1);
        _fulfillViaRealWrapper(req2, 1900); // prizeId 3 = 0.02375 BNB refund (deck now 4999 slots)
        _fulfillViaRealWrapper(req1, 4518); // prizeId 9 = 1.1x (+8k TWAK), last bonus slot of 4999-slot deck
        assertEq(launch.assignedCount(), 2);

        // Claims (prize + referral)
        uint256 r1b = REAL_HOLDER_1.balance;
        vm.prank(REAL_HOLDER_1);
        launch.claimReferral();
        assertEq(REAL_HOLDER_1.balance - r1b, 0.005 ether, "referral claimed");
        vm.prank(REAL_HOLDER_1);
        launch.claim();
        assertEq(token.balanceOf(REAL_HOLDER_1), 88_000e18, "80k + 8k bonus");
        uint256 r2b = REAL_HOLDER_2.balance;
        vm.prank(REAL_HOLDER_2);
        launch.claim();
        assertEq(REAL_HOLDER_2.balance - r2b, 0.02375 ether, "0.02375 BNB refund claimed");

        // 2. Genesis 300: holder 1 uses mintByHandle(), holder 2 uses mint(uint256(keccak256(h2)))
        uint256 genFee = genesis.vrfFeeAt(0.1 gwei);
        vm.prank(REAL_HOLDER_1);
        genesis.mintByHandle{value: genFee}();
        vm.prank(REAL_HOLDER_2);
        genesis.mint{value: genFee}(uint256(keccak256(bytes(h2))));
        assertEq(genesis.mintCount(), 2);
        (,,,,,, uint256 gReq1) = genesis.tickets(REAL_HOLDER_1);
        (,,,,,, uint256 gReq2) = genesis.tickets(REAL_HOLDER_2);
        _fulfillViaRealWrapper(gReq1, 199); // worst-case cold walk + extra (1.1x, +2k TWAK)
        _fulfillViaRealWrapper(gReq2, 0); // 5x (+80k TWAK)
        vm.prank(REAL_HOLDER_1);
        genesis.claim();
        vm.prank(REAL_HOLDER_2);
        genesis.claim();
        assertEq(token.balanceOf(REAL_HOLDER_1), 88_000e18 + 22_000e18);
        assertEq(token.balanceOf(REAL_HOLDER_2), 80_000e18 + 100_000e18);

        // 3. Close mint + finalize listing on REAL mainnet PancakeSwap v2
        vm.warp(block.timestamp + 7 days);
        launch.closeMint();
        launch.finalizeListing();
        assertTrue(token.tradingOpen(), "trading opened");
        IPancakePair pair = IPancakePair(token.pair());
        assertGt(pair.totalSupply(), 0, "LP minted on real PancakeSwap v2");
        assertEq(pair.balanceOf(address(0)), pair.totalSupply(), "100% LP burned to address(0)");

        // 4. Router buy/sell (both Agent ID holder and non-Agent wallet) + flushFees + Rebates
        vm.startPrank(REAL_HOLDER_1);
        uint256 bought1 = router.buy{value: 0.01 ether}(0, block.timestamp + 600);
        assertGt(bought1, 0, "agent buy succeeded on real PancakeSwap v2");
        token.approve(address(router), bought1 / 2);
        uint256 sold1 = router.sell(bought1 / 2, 0, block.timestamp + 600);
        assertGt(sold1, 0, "agent sell succeeded on real PancakeSwap v2");
        vm.stopPrank();
        assertEq(token.allowance(address(router), PANCAKE_ROUTER), 0, "no leftover allowance");

        vm.prank(nonAgent);
        uint256 boughtNon = router.buy{value: 0.01 ether}(0, block.timestamp + 600);
        assertGt(boughtNon, 0, "non-agent buy succeeded");
        uint256 ep = rebates.currentEpoch();
        assertEq(rebates.feesOf(ep, nonAgent), 0, "non-agent gets no rebate credit");
        assertGt(rebates.feesOf(ep, REAL_HOLDER_1), 0, "agent accrued rebate credit");

        uint256 v2Bnb0 = address(drawV2).balance;
        uint256 devBnb0 = dev.balance;
        router.flushFees();
        assertGt(address(drawV2).balance, v2Bnb0, "DrawV2 received 30% router BNB");
        assertGt(dev.balance, devBnb0, "dev received 20% router BNB");

        // 5. DrawV2 enter / fulfill (10x jackpot with entry-scaled BNB bonus) / claim
        uint256 drawFee = drawV2.vrfFeeAt(0.1 gwei);
        uint256 entry = 1_000e18;
        vm.startPrank(REAL_HOLDER_1);
        token.approve(address(drawV2), entry);
        (uint256 spinId, uint256 dReq) = drawV2.enter{value: drawFee}(entry);
        vm.stopPrank();
        _fulfillViaRealWrapper(dReq, 9_900); // 10x jackpot + scaled BNB bonus
        (uint256 winT, uint256 winB) = drawV2.spinPrize(spinId);
        assertEq(winT, 10_000e18, "10x TWAK win");
        assertGt(winB, 0, "scaled BNB bonus won");
        uint256 h1Twak0 = token.balanceOf(REAL_HOLDER_1);
        uint256 h1Bnb0 = REAL_HOLDER_1.balance;
        vm.prank(REAL_HOLDER_1);
        drawV2.claim();
        assertEq(token.balanceOf(REAL_HOLDER_1) - h1Twak0, winT);
        assertEq(REAL_HOLDER_1.balance - h1Bnb0, winB);

        // 6. Rebate epoch claim after 7 days
        vm.warp(block.timestamp + 7 days);
        rebates.checkpoint();
        uint256[] memory eps = new uint256[](1);
        eps[0] = ep;
        uint256 h1t = token.balanceOf(REAL_HOLDER_1);
        uint256 h1b = REAL_HOLDER_1.balance;
        vm.prank(REAL_HOLDER_1);
        rebates.claim(eps);
        assertGt(token.balanceOf(REAL_HOLDER_1), h1t, "rebate TWAK claimed");
        assertGt(REAL_HOLDER_1.balance, h1b, "rebate BNB boost claimed");

        console2.log("Mainnet fork full lifecycle PASSED against real HandleRegistry, VRFWrapper, PancakeV2");
    }
}
