// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {TowackToken} from "../../src/TowackToken.sol";
import {TowackLaunch} from "../../src/TowackLaunch.sol";
import {TowackRouter} from "../../src/TowackRouter.sol";
import {RebateDistributor} from "../../src/RebateDistributor.sol";
import {TeamVesting} from "../../src/TeamVesting.sol";
import {DrawV2} from "../../src/DrawV2.sol";
import {VRFConsumerV25} from "../../src/VRFConsumerV25.sol";
import {MockAgentId} from "../../src/mocks/MockAgentId.sol";
import {IVRFV2PlusWrapper} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFV2PlusWrapper.sol";
import {IPancakePair} from "../../src/interfaces/IPancakeV2.sol";

interface IWrapperCallbacks {
    function s_callbacks(uint256 id) external view returns (address callbackAddress, uint32 callbackGasLimit, uint64 requestGasPrice);
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// Runs only with BSC_FORK=1 (needs network): full listing + swaps against real PancakeSwap v2 testnet.
///   BSC_FORK=1 forge test --match-contract ForkPancake -vv
contract ForkPancakeTest is Test {
    address constant FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;
    address constant ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant COORDINATOR = 0xDA3b641D438362C440Ac5458c57e00a712b66700; // the wrapper's coordinator
    bytes32 constant FAILED_SIG = keccak256("WrapperFulfillmentFailed(uint256,address)");

    function test_ForkListingAndSwaps() public {
        if (!vm.envOr("BSC_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork("bsc_testnet");

        MockAgentId agentId = new MockAgentId();
        // The REAL Chainlink VRF v2.5 direct-funding wrapper on the fork: no subscription, real paid requests.
        IVRFV2PlusWrapper vrf = IVRFV2PlusWrapper(0x471506e6ADED0b9811D05B8cAc8Db25eE839Ac94);
        vm.txGasPrice(1 gwei); // the wrapper prices at tx.gasprice
        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig(address(vrf), 3, 165_000);
        DrawV2 drawV2 = new DrawV2(address(this), address(0), cfg);
        TowackLaunch launch =
            new TowackLaunch(address(agentId), WBNB, address(drawV2), block.timestamp, block.timestamp + 1 days, cfg, false);
        RebateDistributor rebates = new RebateDistributor();
        TeamVesting team = new TeamVesting(address(1));
        TowackToken token = new TowackToken(
            TowackToken.Recipients(
                address(launch), address(rebates), address(team), address(drawV2), address(2), address(3), address(4)
            ),
            FACTORY,
            WBNB
        );
        launch.bindToken(address(token));
        team.bindToken(address(token));
        drawV2.bindToken(address(token));
        TowackRouter router =
            new TowackRouter(address(token), ROUTER, address(agentId), address(rebates), address(drawV2), address(5));
        rebates.bind(address(token), address(router));

        // users pay 0.1 BNB + the VRF fee quoted from the REAL wrapper (estimate at 1 gwei + 10%)
        uint256 fee = launch.vrfFeeAt(1 gwei);
        uint256 price = vrf.calculateRequestPriceNative(165_000, 1);
        assertEq(price, vrf.estimateRequestPriceNative(165_000, 1, 1 gwei));
        assertGt(price, 0);
        assertEq(fee, price * 11_000 / 10_000);
        uint256 w0 = address(vrf).balance;
        for (uint256 i; i < 20; ++i) {
            address u = address(uint160(0xA0000 + i));
            agentId.registerFor(u);
            vm.deal(u, 0.1 ether + fee);
            vm.prank(u);
            launch.mint{value: 0.1 ether + fee}();
        }
        assertEq(address(vrf).balance - w0, 20 * price, "the real wrapper got exactly its price per request");
        assertEq(address(launch).balance, 20 * 0.1 ether, "only the mint price stays");
        // the real wrapper recorded each request against Launch with our exact callback limit
        (,,,,, uint256 lastRid) = launch.tickets(address(uint160(0xA0000 + 19)));
        (address cbAddr, uint32 cbGas,) = IWrapperCallbacks(address(vrf)).s_callbacks(lastRid);
        assertEq(cbAddr, address(launch));
        assertEq(cbGas, 165_000);
        for (uint256 i; i < 20; ++i) {
            (,,,,, uint256 rid) = launch.tickets(address(uint160(0xA0000 + i)));
            uint256[] memory w = new uint256[](1);
            w[0] = uint256(keccak256(abi.encode(777, i)));
            // Full official path minus the node: the REAL coordinator calls the REAL wrapper, which forwards to
            // Launch with exactly 165k gas (_callWithExactGas) and only emits WrapperFulfillmentFailed on failure.
            vm.recordLogs();
            vm.prank(COORDINATOR);
            IWrapperCallbacks(address(vrf)).rawFulfillRandomWords(rid, w);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 k; k < logs.length; ++k) {
                assertTrue(logs[k].topics[0] != FAILED_SIG, "callback failed inside the real wrapper");
            }
        }
        assertEq(launch.assignedCount(), 20, "all 20 prizes assigned through the real wrapper");
        vm.warp(block.timestamp + 1 days);
        launch.closeMint();
        launch.finalizeListing();

        IPancakePair pair = IPancakePair(token.pair());
        assertGt(pair.totalSupply(), 0);
        assertEq(pair.balanceOf(address(0)), pair.totalSupply(), "all LP burned to address(0)");

        address trader = address(0xBEEF);
        agentId.registerFor(trader);
        vm.deal(trader, 1 ether);
        vm.startPrank(trader);
        uint256 got = router.buy{value: 0.01 ether}(0, block.timestamp);
        assertGt(got, 0);
        token.approve(address(router), got);
        uint256 back = router.sell(got, 0, block.timestamp);
        assertGt(back, 0);
        vm.stopPrank();
        assertEq(token.allowance(address(router), ROUTER), 0);
    }
}
