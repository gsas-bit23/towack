// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TowackToken} from "../src/TowackToken.sol";
import {TowackLaunch} from "../src/TowackLaunch.sol";
import {TowackRouter} from "../src/TowackRouter.sol";
import {RebateDistributor} from "../src/RebateDistributor.sol";
import {TeamVesting} from "../src/TeamVesting.sol";
import {DrawV2} from "../src/DrawV2.sol";
import {VRFConsumerV25} from "../src/VRFConsumerV25.sol";
import {MockAgentId} from "../src/mocks/MockAgentId.sol";
import {MockVRFCoordinator} from "../src/mocks/MockVRFCoordinator.sol";
import {MockWBNB, MockPancakeFactory, MockPancakeRouter, MockPancakePair} from "../src/mocks/MockPancake.sol";

contract Fixture is Test {
    MockAgentId agentId;
    MockVRFCoordinator vrf;
    MockWBNB wbnb;
    MockPancakeFactory factory;
    MockPancakeRouter pancake;
    TimelockController timelock;

    TowackToken token;
    TowackLaunch launch;
    TowackRouter router;
    RebateDistributor rebates;
    TeamVesting team;
    DrawV2 drawV2;

    address teamWallet = makeAddr("team");
    address seasons = makeAddr("seasons");
    address ecosystem = makeAddr("ecosystem");
    address polBuffer = makeAddr("polBuffer");
    address dev = makeAddr("dev");

    uint256 mintStart;
    uint256 mintEnd;
    uint256 constant PRICE = 0.1 ether;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        agentId = new MockAgentId();
        vrf = new MockVRFCoordinator();
        wbnb = new MockWBNB();
        factory = new MockPancakeFactory();
        pancake = new MockPancakeRouter(address(factory), address(wbnb));

        address[] memory admins = new address[](1);
        admins[0] = address(this);
        timelock = new TimelockController(2 days, admins, admins, address(0));

        VRFConsumerV25.VRFConfig memory cfg = VRFConsumerV25.VRFConfig({
            coordinator: address(vrf),
            keyHash: bytes32(uint256(1)),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 200_000,
            nativePayment: false
        });

        mintStart = block.timestamp;
        mintEnd = block.timestamp + 7 days;

        drawV2 = new DrawV2(address(timelock), cfg);
        launch = new TowackLaunch(address(agentId), address(wbnb), address(drawV2), mintStart, mintEnd, cfg);
        rebates = new RebateDistributor();
        team = new TeamVesting(teamWallet);

        token = new TowackToken(
            TowackToken.Recipients({
                launch: address(launch),
                rebates: address(rebates),
                team: address(team),
                drawV2: address(drawV2),
                seasons: seasons,
                ecosystem: ecosystem,
                polBuffer: polBuffer
            }),
            address(factory),
            address(wbnb)
        );
        launch.bindToken(address(token));
        team.bindToken(address(token));
        drawV2.bindToken(address(token));
        router = new TowackRouter(
            address(token), address(pancake), address(agentId), address(rebates), address(drawV2), dev
        );
        rebates.bind(address(token), address(router));
    }

    // ---------------------------------------------------------------- helpers
    function user(uint256 i) internal pure returns (address) {
        return address(uint160(0x100000 + i));
    }

    function mintN(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            address u = user(i);
            agentId.registerFor(u);
            vm.deal(u, PRICE);
            vm.prank(u);
            launch.mint{value: PRICE}();
        }
    }

    function closeAndSeed(uint256 word) internal {
        if (launch.mintCount() < launch.MAX_MINTS()) vm.warp(mintEnd);
        launch.closeMint();
        vrf.fulfill(launch.vrfRequestId(), word);
    }

    function launchWith(uint256 n, uint256 word) internal {
        mintN(n);
        closeAndSeed(word);
        launch.finalizeDraw();
    }

    function newAgent(string memory name) internal returns (address a) {
        a = makeAddr(name);
        agentId.registerFor(a);
    }
}
