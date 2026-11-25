// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentDealsV2} from "../../src/AgentDealsV2.sol";
import {IAgentId} from "../../src/interfaces/IAgentId.sol";

/// AgentDealsV2 against LIVE BSC mainnet state: the real SPACE ID Agent ID registry, live TWAK, the live DrawV2 pool
/// and real USDT. Provider, client and judges are real Agent ID holders (judges: public Genesis 300 claimers).
///   BSC_MAINNET_FORK=1 forge test --match-contract ForkAgentDealsV2 -vv
contract ForkAgentDealsV2Test is Test {
    address constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant TWAK = 0xeC5942C5B8952C007E4DCB6c6fF04183e3aBe494;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant DRAW_V2 = 0xdf4499f5690474F502a774eCF6B93E73f57944C8;

    address constant PROVIDER = 0x56a9813E93363fb5141bdDD332f9BBbdC955e2b8;
    address constant CLIENT = 0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d;
    address[4] JUDGES = [
        0x0152F51E7B657f3EB730804070Ce9A94ECa89b02,
        0x3ff42f11b0f14A95092bd72B8771Dc73c7F13423,
        0x42B5155008dc292e2F9211b3B65B6BF6dF6F118b,
        0x974FAd0a00F4C3999b05b2aB0885D9D03736a280
    ];
    address treasury = makeAddr("treasury");

    AgentDealsV2 deals;
    uint256 clientId;

    function setUp() public {
        if (!vm.envOr("BSC_MAINNET_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("BSC_MAINNET_RPC", string("https://bsc-rpc.publicnode.com")));
        deals = new AgentDealsV2(AGENT_ID, TWAK, USDT, treasury, DRAW_V2);
        clientId = uint256(keccak256(bytes(IAgentId(AGENT_ID).handleOf(CLIENT))));
        for (uint256 i = 0; i < JUDGES.length; i++) {
            assertEq(IAgentId(AGENT_ID).balanceOf(JUDGES[i]), 1, "judge holds a real Agent ID");
        }
    }

    function _delivered(address tok, uint256 amount) internal returns (uint256 id) {
        deal(tok, CLIENT, IERC20(tok).balanceOf(CLIENT) + amount);
        vm.prank(PROVIDER);
        id = deals.createOffer(tok, amount, clientId, 1 days, keccak256("fork job"));
        vm.startPrank(CLIENT);
        IERC20(tok).approve(address(deals), amount);
        deals.accept(id);
        vm.stopPrank();
        vm.prank(PROVIDER);
        deals.deliver(id, keccak256("done"));
    }

    function _vote(uint256 id, bool[4] memory votes) internal {
        for (uint256 i = 0; i < 4; i++) {
            bytes32 salt = keccak256(abi.encode(i));
            bytes32 c = deals.voteCommitment(id, JUDGES[i], votes[i], salt);
            vm.prank(JUDGES[i]);
            deals.commitVote(id, c);
        }
        vm.warp(block.timestamp + 48 hours);
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(JUDGES[i]);
            deals.revealVote(id, votes[i], keccak256(abi.encode(i)));
        }
        vm.warp(block.timestamp + 24 hours);
    }

    function test_Fork_TwakPassVerdict_RealJudges_SeedsLiveDrawV2() public {
        uint256 amount = 10_000e18;
        uint256 poolBefore = IERC20(TWAK).balanceOf(DRAW_V2);
        uint256 id = _delivered(TWAK, amount);
        _vote(id, [true, true, true, false]);
        deals.finalize(id);

        assertEq(IERC20(TWAK).balanceOf(treasury), 80e18 + (50e18 - (uint256(50e18) / 3) * 3)); // + rounding dust
        assertEq(IERC20(TWAK).balanceOf(DRAW_V2) - poolBefore, 20e18);
        uint256 judgeBefore = IERC20(TWAK).balanceOf(JUDGES[0]);
        vm.prank(JUDGES[0]);
        deals.claimJudgeReward(id);
        assertEq(IERC20(TWAK).balanceOf(JUDGES[0]) - judgeBefore, uint256(50e18) / 3);
        assertEq(deals.claimable(id, JUDGES[3]), 0);
    }

    function test_Fork_UsdtFailVerdict_RefundsClient() public {
        uint256 amount = 30e18;
        uint256 id = _delivered(USDT, amount);
        uint256 clientBefore = IERC20(USDT).balanceOf(CLIENT);
        _vote(id, [false, false, false, true]);
        deals.finalize(id);

        assertEq(IERC20(USDT).balanceOf(CLIENT) - clientBefore, 29.85e18); // 99.5%
        assertEq(deals.claimable(id, JUDGES[1]), 0.05e18); // 0.15 USDT / 3
        assertEq(deals.claimable(id, JUDGES[3]), 0);
    }

    function test_Fork_PartyCannotJudge() public {
        uint256 id = _delivered(USDT, 5e18);
        vm.prank(CLIENT);
        vm.expectRevert(AgentDealsV2.PartyCannotJudge.selector);
        deals.commitVote(id, bytes32(uint256(1)));
    }
}
