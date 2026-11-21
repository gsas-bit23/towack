// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVRFCoordinatorV2Plus, VRFV2PlusClient} from "./interfaces/IVRFCoordinatorV2Plus.sol";

/// @notice Minimal, ownerless Chainlink VRF v2.5 consumer. All VRF config is immutable.
/// The callback only stores randomness; heavy work happens in separate permissionless calls.
abstract contract VRFConsumerV25 {
    struct VRFConfig {
        address coordinator;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
    }

    error OnlyCoordinator(address have, address want);

    IVRFCoordinatorV2Plus public immutable vrfCoordinator;
    bytes32 public immutable vrfKeyHash;
    uint256 public immutable vrfSubId;
    uint16 public immutable vrfRequestConfirmations;
    uint32 public immutable vrfCallbackGasLimit;
    bool public immutable vrfNativePayment;

    constructor(VRFConfig memory cfg) {
        require(cfg.coordinator != address(0), "VRF: coordinator");
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
