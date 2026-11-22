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
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockWBNB, MockPancakeFactory, MockPancakeRouter, MockPancakePair} from "../src/mocks/MockPancake.sol";

contract Fixture is Test {
    MockAgentId agentId;
    /// Official Chainlink VRF v2.5 mock with a native-payment subscription (no MockVRFCoordinator).
    VRFCoordinatorV2_5Mock vrf;
    uint256 subId;
    bytes32 constant KEY_HASH = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    uint32 constant CALLBACK_GAS = 250_000;
    // Mock billing: flat 0.0001 BNB + 1 gwei per callback gas, paid from the sub's native balance.
    uint96 constant MOCK_BASE_FEE = 1e14;
    uint96 constant MOCK_GAS_PRICE = 1e9;
    int256 constant MOCK_WEI_PER_LINK = 4e15;
    bytes32 constant FULFILLED_SIG = keccak256("RandomWordsFulfilled(uint256,uint256,uint256,uint96,bool,bool,bool)");
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
        vrf = new VRFCoordinatorV2_5Mock(MOCK_BASE_FEE, MOCK_GAS_PRICE, MOCK_WEI_PER_LINK);
        subId = vrf.createSubscription();
        vm.deal(address(this), 10_000 ether);
        vrf.fundSubscriptionWithNative{value: 5_000 ether}(subId);
        wbnb = new MockWBNB();
        factory = new MockPancakeFactory();
        pancake = new MockPancakeRouter(address(factory), address(wbnb));

        address[] memory admins = new address[](1);
        admins[0] = address(this);
        timelock = new TimelockController(2 days, admins, admins, address(0));

        VRFConsumerV25.VRFConfig memory cfg = vrfCfg();

        mintStart = block.timestamp;
        mintEnd = block.timestamp + 7 days;

        drawV2 = new DrawV2(address(timelock), address(0), cfg);
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
        vrf.addConsumer(subId, address(drawV2));
        vrf.addConsumer(subId, address(launch));
    }

    // ---------------------------------------------------------------- VRF helpers
    /// Production-shaped config against the official mock: 50 gwei lane key hash, native payment, 3 conf.
    function vrfCfg() internal view returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({
            coordinator: address(vrf),
            keyHash: KEY_HASH,
            subId: subId,
            requestConfirmations: 3,
            callbackGasLimit: CALLBACK_GAS,
            nativePayment: true
        });
    }

    /// Delivers `word` for request `id` to `consumer` through the official mock (the mock forwards exactly
    /// the request's callbackGasLimit and bills the subscription). Asserts the callback did not revert / OOG.
    function fulfillTo(address consumer, uint256 id, uint256 word) internal {
        bool ok = fulfillToRaw(consumer, id, word);
        assertTrue(ok, "VRF callback failed (reverted or out of gas)");
    }

    /// Same as fulfillTo but returns the mock's `success` flag instead of asserting it.
    function fulfillToRaw(address consumer, uint256 id, uint256 word) internal returns (bool success) {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        vm.recordLogs();
        vrf.fulfillRandomWordsWithOverride(id, consumer, words);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            Vm.Log memory l = logs[i - 1];
            if (l.emitter == address(vrf) && l.topics[0] == FULFILLED_SIG) {
                (,,, success,) = abi.decode(l.data, (uint256, uint96, bool, bool, bool));
                return success;
            }
        }
        revert("no RandomWordsFulfilled");
    }

    bytes32 constant REQUESTED_SIG =
        keccak256("RandomWordsRequested(bytes32,uint256,uint256,uint256,uint16,uint32,uint32,bytes,address)");

    struct VrfReq {
        bytes32 keyHash;
        uint256 requestId;
        uint256 subId;
        uint16 confirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
        address sender;
    }

    /// Last RandomWordsRequested in `logs` (from vm.getRecordedLogs()).
    function lastVrfRequest(Vm.Log[] memory logs) internal view returns (VrfReq memory r) {
        for (uint256 i = logs.length; i > 0; --i) {
            Vm.Log memory l = logs[i - 1];
            if (l.emitter == address(vrf) && l.topics[0] == REQUESTED_SIG) {
                r.keyHash = l.topics[1];
                r.subId = uint256(l.topics[2]);
                r.sender = address(uint160(uint256(l.topics[3])));
                (r.requestId,, r.confirmations, r.callbackGasLimit, r.numWords, r.extraArgs) =
                    abi.decode(l.data, (uint256, uint256, uint16, uint32, uint32, bytes));
                return r;
            }
        }
        revert("no RandomWordsRequested");
    }

    function subNativeBalance() internal view returns (uint96 nb) {
        (, nb,,,) = vrf.getSubscription(subId);
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

    /// @dev Deterministic per-request VRF word for tests.
    function wordFor(uint256 salt, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(salt, i)));
    }

    /// @dev Fulfils the live VRF request of user(from) .. user(from+n-1).
    function fulfillUsers(uint256 from, uint256 n, uint256 salt) internal {
        for (uint256 i = from; i < from + n; ++i) {
            fulfillTo(address(launch), requestOf(user(i)), wordFor(salt, i));
        }
    }

    function requestOf(address u) internal view returns (uint256 id) {
        (,,,,, id) = launch.tickets(u);
    }

    function close() internal {
        if (launch.mintCount() < launch.MAX_MINTS()) vm.warp(mintEnd);
        launch.closeMint();
    }

    /// mint n, fulfil every request, close, finalize the listing.
    function launchWith(uint256 n, uint256 salt) internal {
        mintN(n);
        fulfillUsers(0, n, salt);
        close();
        launch.finalizeListing();
    }

    function newAgent(string memory name) internal returns (address a) {
        a = makeAddr(name);
        agentId.registerFor(a);
    }
}
