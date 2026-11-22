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
import {VRFWrapperMock} from "./VRFWrapperMock.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockWBNB, MockPancakeFactory, MockPancakeRouter, MockPancakePair} from "../src/mocks/MockPancake.sol";

contract Fixture is Test {
    MockAgentId agentId;
    /// Mock of Chainlink's official VRFV2PlusWrapper (direct funding, native), live BSC wrapper config.
    VRFWrapperMock vrf;
    /// Per-contract callback gas limits (production values; see docs/ARCHITECTURE.md for the measurements).
    /// Measured worst case cold, gas actually used inside the wrapper's exact-gas CALL (incl. the CALL's own
    /// cold-access cost): see test_CallbackGas_* in OfficialVRF.t.sol. Limits keep >= 20% headroom over those.
    uint32 constant LAUNCH_CALLBACK_GAS = 165_000;
    uint32 constant GENESIS_CALLBACK_GAS = 170_000;
    uint32 constant DRAW_CALLBACK_GAS = 200_000;
    /// tx.gasprice for every test call (the wrapper prices requests at tx.gasprice; 0 would make them free).
    uint256 constant TEST_GAS_PRICE = 1 gwei;
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
    /// Buffered VRF fee quotes `vrfFeeAt(TEST_GAS_PRICE)` (what the UI would send), cached after deploy so tests
    /// can use them right after vm.prank without an extra external call eating the prank. The exact wrapper
    /// price is `wrapperPrice(limit)`; the difference is refunded in the same tx.
    uint256 launchFee;
    uint256 drawFee;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        agentId = new MockAgentId();
        vm.txGasPrice(TEST_GAS_PRICE);
        vrf = new VRFWrapperMock();
        vm.deal(address(this), 10_000 ether);
        wbnb = new MockWBNB();
        factory = new MockPancakeFactory();
        pancake = new MockPancakeRouter(address(factory), address(wbnb));

        address[] memory admins = new address[](1);
        admins[0] = address(this);
        timelock = new TimelockController(2 days, admins, admins, address(0));

        mintStart = block.timestamp;
        mintEnd = block.timestamp + 7 days;

        drawV2 = new DrawV2(address(timelock), address(0), vrfCfg(DRAW_CALLBACK_GAS));
        launch = new TowackLaunch(
            address(agentId),
            address(wbnb),
            address(drawV2),
            mintStart,
            mintEnd,
            vrfCfg(LAUNCH_CALLBACK_GAS),
            launchInstantClose()
        );
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
        launchFee = launch.vrfFeeAt(TEST_GAS_PRICE);
        drawFee = drawV2.vrfFeeAt(TEST_GAS_PRICE);
    }

    /// Launch `instantClose` flag for this fixture. False (production default); rehearsal tests override it.
    function launchInstantClose() internal pure virtual returns (bool) {
        return false;
    }

    // ---------------------------------------------------------------- VRF helpers
    /// Production-shaped config against the wrapper mock: 3 confirmations, per-contract callback limit.
    function vrfCfg(uint32 callbackGas) internal view returns (VRFConsumerV25.VRFConfig memory) {
        return VRFConsumerV25.VRFConfig({wrapper: address(vrf), requestConfirmations: 3, callbackGasLimit: callbackGas});
    }

    /// Exact wrapper price at `gp` (official formula, live BSC config): 13,400 wrapper overhead +
    /// (limit + 99,500 + 435) * 1.6, all times the gas price.
    function wrapperPriceAt(uint32 callbackGas, uint256 gp) internal pure returns (uint256) {
        return gp * 13_400 + gp * (uint256(callbackGas) + 99_500 + 435) * 160 / 100;
    }

    function wrapperPrice(uint32 callbackGas) internal pure returns (uint256) {
        return wrapperPriceAt(callbackGas, TEST_GAS_PRICE);
    }

    /// Delivers `word` for request `id` through the wrapper mock (exactly the request's callbackGasLimit).
    /// `consumer` is the expected recipient; asserts the callback did not revert / OOG.
    function fulfillTo(address consumer, uint256 id, uint256 word) internal {
        bool ok = fulfillToRaw(consumer, id, word);
        assertTrue(ok, "VRF callback failed (reverted or out of gas)");
    }

    /// Same as fulfillTo but returns the callback's success flag. Delivers to `consumer` with the gas limit the
    /// request was made with (so a request can also be delivered to the wrong consumer on purpose).
    function fulfillToRaw(address consumer, uint256 id, uint256 word) internal returns (bool success) {
        (address c, uint32 gasLimit,,,) = vrf.callbacks(id);
        require(c != address(0), "unknown request");
        if (c == consumer) return vrf.fulfill(id, word);
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        return vrf.fulfillRawTo(consumer, id, words, gasLimit);
    }

    bytes32 constant REQUESTED_SIG = keccak256("Requested(uint256,address,uint32,uint16,uint256)");

    struct VrfReq {
        uint256 requestId;
        address sender;
        uint32 callbackGasLimit;
        uint16 confirmations;
        uint256 paid;
    }

    /// Last wrapper `Requested` in `logs` (from vm.getRecordedLogs()).
    function lastVrfRequest(Vm.Log[] memory logs) internal view returns (VrfReq memory r) {
        for (uint256 i = logs.length; i > 0; --i) {
            Vm.Log memory l = logs[i - 1];
            if (l.emitter == address(vrf) && l.topics[0] == REQUESTED_SIG) {
                r.requestId = uint256(l.topics[1]);
                r.sender = address(uint160(uint256(l.topics[2])));
                (r.callbackGasLimit, r.confirmations, r.paid) = abi.decode(l.data, (uint32, uint16, uint256));
                return r;
            }
        }
        revert("no wrapper Requested");
    }

    // ---------------------------------------------------------------- helpers
    function user(uint256 i) internal pure returns (address) {
        return address(uint160(0x100000 + i));
    }

    function mintN(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            address u = user(i);
            agentId.registerFor(u);
            vm.deal(u, PRICE + launchFee);
            vm.prank(u);
            launch.mint{value: PRICE + launchFee}();
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

    /// Retries / enters from the test contract get the unused fee buffer refunded.
    receive() external payable virtual {}

    function newAgent(string memory name) internal returns (address a) {
        a = makeAddr(name);
        agentId.registerFor(a);
    }
}
