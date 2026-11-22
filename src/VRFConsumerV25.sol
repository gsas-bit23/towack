// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice Minimal, ownerless Chainlink VRF v2.5 consumer. All VRF config is immutable.
/// Production config = the official coordinator, a registered key hash, a funded native-payment subscription
/// that lists this contract as a consumer, 3 confirmations. Only the coordinator may deliver words; the
/// coordinator calls `rawFulfillRandomWords` with exactly `vrfCallbackGasLimit` gas, so callbacks are
/// kept to a few SSTOREs and never revert on unknown / stale requests.
/// Trade-off vs Chainlink's `VRFConsumerBaseV2Plus`: no owner can `setCoordinator`, so a Chainlink
/// coordinator migration needs a redeploy of the consumer.
abstract contract VRFConsumerV25 {
    struct VRFConfig {
        address coordinator;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    /// @dev Chainlink v2.5 bounds: min confirmations 3 (BSC), max callback gas 2,500,000 (BSC testnet config).
    uint16 public constant MIN_REQUEST_CONFIRMATIONS = 3;
    uint16 public constant MAX_REQUEST_CONFIRMATIONS = 200;
    uint32 public constant MIN_CALLBACK_GAS = 100_000;
    uint32 public constant MAX_CALLBACK_GAS = 2_500_000;

    error OnlyCoordinator(address have, address want);

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    bytes32 public immutable vrfKeyHash;
    uint256 public immutable vrfSubId;
    uint16 public immutable vrfRequestConfirmations;
    uint32 public immutable vrfCallbackGasLimit;
    bool public immutable vrfNativePayment;

    constructor(VRFConfig memory cfg) {
        require(cfg.coordinator.code.length > 0, "VRF: coordinator");
        require(cfg.keyHash != bytes32(0), "VRF: keyHash");
        require(cfg.subId != 0, "VRF: subId");
        require(
            cfg.requestConfirmations >= MIN_REQUEST_CONFIRMATIONS
                && cfg.requestConfirmations <= MAX_REQUEST_CONFIRMATIONS,
            "VRF: confirmations"
        );
        require(cfg.callbackGasLimit >= MIN_CALLBACK_GAS && cfg.callbackGasLimit <= MAX_CALLBACK_GAS, "VRF: gas");
        vrfCoordinator = IVRFCoordinatorV2Plus(cfg.coordinator);
        vrfKeyHash = cfg.keyHash;
        vrfSubId = cfg.subId;
        vrfRequestConfirmations = cfg.requestConfirmations;
        vrfCallbackGasLimit = cfg.callbackGasLimit;
        vrfNativePayment = cfg.nativePayment;
    }

    function _requestRandomWord() internal returns (uint256) {
        return vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient.argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfNativePayment}))
            })
        );
    }

    /// @dev Called by the coordinator. Name/signature must match Chainlink's VRFConsumerBaseV2Plus.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyCoordinator(msg.sender, address(vrfCoordinator));
        _fulfillRandomWords(requestId, randomWords);
    }

    function _fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;
}
